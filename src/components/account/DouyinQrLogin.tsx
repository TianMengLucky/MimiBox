import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { pluginInvoke } from "../../lib/tauriInvoke";

/** 抖音扫码登录：二维码轮询 + 过期无感换码 + IP 限流指数退避冷却
 *  + 扫码触发短信二次验证（error 2046 / verification_required）的 MFA 状态机。 */

interface DouyinQrStart { qrImage: string }
interface DouyinQrPoll {
  status: "waiting" | "scanned" | "success" | "expired" | "verification_required" | "verification_unsupported";
  message: string;
  /** 过期无感换码：新二维码图片（data URI） */
  newQrImage?: string;
  /** 扫码二次验证：脱敏手机号（可能为 null） */
  mobile?: string | null;
}

export function DouyinQrLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [qr, setQr] = useState<DouyinQrStart | null>(null);
  const [poll, setPoll] = useState<DouyinQrPoll | null>(null);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const startingRef = useRef(false);
  // 连续冷却失败次数:首次 poll 立即失败 → 冷却 → 重试 → 又立即失败
  // 每次失败 cooldownFailures++,冷却时间指数增长:60s → 120s → 240s → 480s
  // 超过 4 次后判定为 IP 限流严重,停止重试
  const cooldownFailuresRef = useRef(0);
  // 最后一次成功轮询的二维码状态：scanned 阶段遇到 error 7 时改用短退避快速重试
  // （手机确认窗口仅约 1 分钟，60s 长退避会错过 confirmed；扫码本身是强信任信号）
  const lastQrStatusRef = useRef<"unknown" | "new" | "scanned">("unknown");
  // 扫码触发短信二次验证（error 2046）时的 MFA 状态
  const [mfaMobile, setMfaMobile] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState("");
  const [mfaResendIn, setMfaResendIn] = useState(0);
  // 轮询循环恢复句柄：MFA 校验通过后直接续跑原 check 循环（无需重建 effect）
  const checkRef = useRef<(() => void) | null>(null);

  // 重发验证码倒计时
  useEffect(() => {
    if (mfaResendIn <= 0) return;
    const t = window.setTimeout(() => setMfaResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [mfaResendIn]);

  const start = useCallback(() => {
    if (startingRef.current) return;
    startingRef.current = true;
    setError("");
    setPoll(null);
    setMfaMobile(null);
    setMfaCode("");
    setMfaError("");
    setMfaResendIn(0);
    checkRef.current = null;
    // 用户手动触发重新加载时,重置连续冷却失败计数
    cooldownFailuresRef.current = 0;
    lastQrStatusRef.current = "unknown";
    // 先重置 Rust 侧 web 会话（清空 cookie/指纹标识，强制重新预热首页与 ttwid），
    // 等价于浏览器里刷新页面换新环境，降低连续风控评分
    pluginInvoke("account", "douyin_reset_session").catch(() => undefined).finally(() => {
      pluginInvoke<DouyinQrStart>("account", "douyin_qr_start")
        .then((data) => setQr(data))
        .catch((reason) => setError(String(reason)))
        .finally(() => { startingRef.current = false; });
    });
  }, []);

  // 冷却倒计时：到 0 时自动重新加载二维码
  useEffect(() => {
    if (cooldown <= 0) return;
    if (cooldown === 1) {
      const t = window.setTimeout(() => { setCooldown(0); start(); }, 1000);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown, start]);

  useEffect(start, [start]);
  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    let timer: number | undefined;
    let pollCount = 0;
    let errorCount = 0;
    // 首次 poll 即遇 error 7 时的短重试计数：先在二维码有效期内快速重试 3 次，
    // 再进入 60s 长冷却（轻限流场景下用户可能已扫码，重试可捞到 scanned/confirmed）
    let earlyErrorRetries = 0;
    // 已扫码阶段遇 error 7 的短重试计数：最多 8 次（约 64s，覆盖二维码有效期），
    // 超过仍限流则提示刷新，避免无限空转
    let scannedErrorRetries = 0;
    // 网页端轮询间隔约 5-6 秒，二维码有效期约 3 分钟；
    // 过期后后端会从 expired 响应中无感换码（更新 qr 触发本 effect 重建），
    // 这里 35 次（约 3.5 分钟）作为单轮上限兜底。
    const maxPolls = 35;
    const maxErrors = 3;

    // 轮询节奏（带随机抖动）， passport 请求额度有限需省着用：
    // - waiting（待扫码）: 约 8 秒一次，拉长间隔节省请求额度
    // - scanned（已扫码，等手机确认）: 约 4.5 秒一次，尽快感知确认结果
    // - error 退避: 待扫码阶段 60s → 120s → 240s（指数）；
    //   已扫码阶段固定 8s 短退避（抢在手机确认窗口/token 有效期内捞到 confirmed）
    const getNextDelay = (lastStatus: string, isError: boolean) => {
      if (isError) {
        // 已扫码等确认阶段：14s 长退避（而非 8s），降低请求密度给服务端额度恢复窗口，
        // 同时用户在手机上点确认本身需要数秒，不必高频轮询
        if (lastQrStatusRef.current === "scanned") return 14000;
        return 60000 * Math.pow(2, errorCount - 1);
      }

      if (lastStatus === "scanned") {
        // 已扫码等确认：7s 间隔（给用户在手机上点确认的时间，同时减少请求消耗）
        const jitter = 7000 * (0.85 + Math.random() * 0.3);
        return Math.floor(jitter);
      }

      const baseDelay = 8000;
      const jitter = baseDelay * (0.85 + Math.random() * 0.3);
      return Math.floor(jitter);
    };

    const check = async () => {
      try {
        if (pollCount >= maxPolls) {
          if (!stopped) {
            setPoll({ status: "expired", message: "二维码已过期，请刷新" });
          }
          return;
        }

        const result = await pluginInvoke<DouyinQrPoll>("account", "douyin_qr_poll");
        if (stopped) return;

        setPoll(result);
        if (result.status === "success") {
          onLoggedIn();
        } else if (result.status === "verification_required") {
          // 账号需要短信二次验证：后端已自动发送首条短信，这里停止轮询，
          // 等用户在 MFA 输入框提交验证码，校验通过后由 checkRef 续跑轮询
          setMfaMobile(result.mobile ?? null);
          setMfaResendIn(60);
          return;
        } else if (result.status === "verification_unsupported") {
          // 账号没有手机短信二次验证（如仅人脸/本机号码验证）：
          // 停在提示卡片，引导用户去抖音 App 完成验证后刷新二维码重新扫码
          return;
        } else if (result.status === "expired") {
          // 无感换码：expired 响应体内嵌新二维码时，替换图片后本 effect 自动
          // 重建轮询循环（新 token 已在后端会话内更新），与网页端行为一致
          if (result.newQrImage) {
            setQr((prev) => prev ? { qrImage: result.newQrImage! } : prev);
            lastQrStatusRef.current = "unknown";
            setPoll({ status: "waiting", message: "二维码已自动刷新，请重新扫码。" });
          }
          // 无内嵌新码：保持 expired 状态展示"刷新二维码"按钮，停止本轮轮询
        } else if (result.status === "scanned") {
          // 已扫码等手机确认：记录状态，error 7 时走短退避
          lastQrStatusRef.current = "scanned";
          errorCount = 0;
          const delay = getNextDelay("scanned", false);
          pollCount++;
          timer = window.setTimeout(check, delay);
        } else {
          // 后端在 error_code 7（访问太频繁）时已返回 waiting + 提示
          if (result.message.includes("过于频繁") || result.message.includes("退避")) {
            // 已扫码等确认阶段：固定 8s 短退避快速重试，不累加错误计数、不进冷却，
            // 抢在手机确认窗口内捞到 confirmed；连续 8 次（约 64s，覆盖二维码有效期）
            // 仍限流则提示刷新，避免无限空转
            if (lastQrStatusRef.current === "scanned") {
              if (scannedErrorRetries < 6) {
                scannedErrorRetries++;
                setPoll({ status: "waiting", message: "已扫码，正在等待手机确认…" });
                timer = window.setTimeout(check, getNextDelay("scanned", true));
                return;
              }
              setError("网络限流，登录确认超时，请刷新二维码后重新扫码。");
              return;
            }
            errorCount++;
            // 首次 poll 就触发 error_code 7，说明进入会话前已被 IP/网络维度限流：
            // 先在二维码有效期（约 60s）内 12s 短退避重试 3 次，捞可能已扫码/确认的状态；
            // 仍持续限流再启动 60 秒冷却倒计时，到 0 后自动重新加载二维码
            if (pollCount === 0 && earlyErrorRetries < 3) {
              earlyErrorRetries++;
              setPoll({ status: "waiting", message: `网络繁忙，正在重试（${earlyErrorRetries}/3）…` });
              timer = window.setTimeout(check, 12000);
              return;
            }
            if (pollCount === 0) {
              setQr(null);
              setPoll(null);
              // 指数退避冷却:60s → 120s → 240s → 480s
              // 超过 4 次判定 IP 限流严重,停止自动重试
              cooldownFailuresRef.current += 1;
              if (cooldownFailuresRef.current > 4) {
                setError("抖音 IP 限流严重,请等待几小时后再试,或更换网络环境");
                return;
              }
              const cd = 60 * Math.pow(2, cooldownFailuresRef.current - 1);
              setCooldown(cd);
              return;
            }
            if (errorCount <= maxErrors) {
              const backoffDelay = getNextDelay(result.status, true);
              setPoll({ status: "waiting", message: `请求过于频繁，${Math.round(backoffDelay / 1000)} 秒后重试…` });
              timer = window.setTimeout(check, backoffDelay);
            } else {
              setQr(null);
              setPoll(null);
              cooldownFailuresRef.current += 1;
              if (cooldownFailuresRef.current > 4) {
                setError("抖音 IP 限流严重,请等待几小时后再试,或更换网络环境");
                return;
              }
              const cd = 60 * Math.pow(2, cooldownFailuresRef.current - 1);
              setCooldown(cd);
            }
          } else {
            lastQrStatusRef.current = "new";
            errorCount = 0;
            // poll 成功至少一次,说明限流已解除,重置连续冷却失败计数
            if (pollCount > 0) cooldownFailuresRef.current = 0;
            const delay = getNextDelay(result.status, false);
            pollCount++;
            timer = window.setTimeout(check, delay);
          }
        }
      } catch (reason) {
        if (stopped) return;

        const errorMsg = String(reason);

        if (errorMsg.includes("(7)") || errorMsg.includes("太频繁")) {
          // 已扫码等确认阶段：14s 长退避重试（同 try 分支逻辑，降低请求密度）
          if (lastQrStatusRef.current === "scanned") {
            if (scannedErrorRetries < 6) {
              scannedErrorRetries++;
              setPoll({ status: "waiting", message: "已扫码，正在等待手机确认…" });
              timer = window.setTimeout(check, 14000);
              return;
            }
            setError("网络限流，登录确认超时，请刷新二维码后重新扫码。");
            return;
          }
          errorCount++;
          // 首次 poll 失败：先短退避重试 3 次再进冷却（同 try 分支）
          if (pollCount === 0 && earlyErrorRetries < 3) {
            earlyErrorRetries++;
            setPoll({ status: "waiting", message: `网络繁忙，正在重试（${earlyErrorRetries}/3）…` });
            timer = window.setTimeout(check, 12000);
            return;
          }
          // 同上：持续限流说明会话外限流，启动指数退避冷却
          if (pollCount === 0) {
            setQr(null);
            setPoll(null);
            cooldownFailuresRef.current += 1;
            if (cooldownFailuresRef.current > 4) {
              setError("抖音 IP 限流严重,请等待几小时后再试,或更换网络环境");
              return;
            }
            const cd = 60 * Math.pow(2, cooldownFailuresRef.current - 1);
            setCooldown(cd);
            return;
          }
          if (errorCount <= maxErrors) {
            const backoffDelay = getNextDelay("error", true);
            setPoll({ status: "waiting", message: `请求过于频繁，${Math.round(backoffDelay / 1000)} 秒后重试…` });
            timer = window.setTimeout(check, backoffDelay);
          } else {
            setQr(null);
            setPoll(null);
            cooldownFailuresRef.current += 1;
            if (cooldownFailuresRef.current > 4) {
              setError("抖音 IP 限流严重,请等待几小时后再试,或更换网络环境");
              return;
            }
            const cd = 60 * Math.pow(2, cooldownFailuresRef.current - 1);
            setCooldown(cd);
          }
        } else {
          setError(errorMsg);
        }
      }
    };

    // 首次轮询延迟约 5.5 秒：浏览器取码后会先完成 mssdk 初始化与环境上报，
    // 过早发起 check_qrconnect 风控评分更高（实测新会话 token 带 _hl 高风险后缀）
    timer = window.setTimeout(check, 5200 + Math.floor(Math.random() * 800));
    // MFA 校验通过后续跑：重置各计数器，给二次验证后的确认流程一个完整轮询窗口
    checkRef.current = () => {
      pollCount = 0;
      errorCount = 0;
      earlyErrorRetries = 0;
      scannedErrorRetries = 0;
      lastQrStatusRef.current = "scanned";
      check();
    };
    return () => { stopped = true; checkRef.current = null; if (timer) window.clearTimeout(timer); };
  }, [onLoggedIn, qr]);

  // 提交短信二次验证码：成功后票据留在后端会话，续跑轮询等待 confirmed
  const submitMfa = async () => {
    const value = mfaCode.trim();
    if (mfaBusy || value.length !== 6) return;
    setMfaBusy(true);
    setMfaError("");
    try {
      await pluginInvoke("account", "douyin_qr_sms_validate", { code: value });
      setMfaCode("");
      setPoll({ status: "waiting", message: "验证成功，正在完成登录…" });
      checkRef.current?.();
    } catch (reason) {
      setMfaError(String(reason));
    } finally {
      setMfaBusy(false);
    }
  };

  // 重新发送扫码二次验证短信
  const resendMfa = async () => {
    if (mfaBusy || mfaResendIn > 0) return;
    setMfaBusy(true);
    setMfaError("");
    try {
      const result = await pluginInvoke<{ mobile: string | null }>("account", "douyin_qr_sms_send");
      if (result.mobile) setMfaMobile(result.mobile);
      setMfaResendIn(60);
    } catch (reason) {
      setMfaError(String(reason));
    } finally {
      setMfaBusy(false);
    }
  };

  const mfaActive = poll?.status === "verification_required";
  const mfaUnsupported = poll?.status === "verification_unsupported";

  return <div className="account-qr account-qr--douyin">
    {error ? <><p className="account-error">{error}</p><button type="button" className="account-button" onClick={start}>重新加载二维码</button></> : cooldown > 0 ? <>
      <div className="account-qr__placeholder">抖音登录请求频率受限，{cooldown} 秒后自动重试…</div>
    </> : <>
      {mfaUnsupported ? (
        <div role="status" className="flex w-[min(260px,40vh,calc(100vw-64px))] flex-col items-center gap-3 rounded-[14px] bg-white p-4 shadow-[0_4px_16px_rgb(133_77_96/12%)]">
          <Icon icon="mdi:shield-alert" className="text-3xl text-amber-500" aria-hidden="true" />
          <p className="m-0 text-center text-sm font-semibold text-[#66535a]">需要在抖音 App 完成验证</p>
          <p className="m-0 text-center text-xs leading-relaxed text-[#7a6a71]">{poll?.message}</p>
          <button
            type="button"
            className="account-button w-full"
            onClick={start}
          >
            刷新二维码重新登录
          </button>
        </div>
      ) : mfaActive ? (
        <div className="flex w-[min(220px,34vh,calc(100vw-64px))] flex-col items-center gap-3 rounded-[14px] bg-white p-4 shadow-[0_4px_16px_rgb(133_77_96/12%)]">
          <Icon icon="mdi:cellphone-message" className="text-3xl text-pink-400" aria-hidden="true" />
          <p className="m-0 text-center text-sm leading-relaxed text-[#7a6a71]">
            账号需要短信二次验证
            {mfaMobile ? <>，验证码将发送至<br /><span className="font-semibold text-[#c05a87]">{mfaMobile}</span></> : "，验证码已发送至账号绑定手机"}
          </p>
          <label className="account-field w-full">
            <span>短信验证码</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6 位数字验证码"
              value={mfaCode}
              disabled={mfaBusy}
              onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(event) => { if (event.key === "Enter") void submitMfa(); }}
            />
          </label>
          <button
            type="button"
            className="account-button w-full"
            disabled={mfaBusy || mfaCode.trim().length !== 6}
            onClick={() => void submitMfa()}
          >
            {mfaBusy ? "验证中…" : "确认并登录"}
          </button>
          <button
            type="button"
            className="account-button account-button--ghost !mt-0 px-4 py-1.5 text-xs"
            disabled={mfaBusy || mfaResendIn > 0}
            onClick={() => void resendMfa()}
          >
            {mfaResendIn > 0 ? `${mfaResendIn} 秒后可重发` : "重新发送验证码"}
          </button>
          {mfaError && <p className="account-error !mt-0 text-xs">{mfaError}</p>}
        </div>
      ) : qr ? <img className="account-qr__image" src={qr.qrImage} alt="抖音登录二维码" /> : <div className="account-qr__placeholder">正在生成二维码…</div>}
      {/* 无短信二次验证时引导文案已在卡片内展示，避免重复 */}
      {!mfaUnsupported && <p className="account-qr__status" aria-live="polite">{poll?.message ?? "请使用抖音 App 扫一扫，扫描后请在手机上确认。"}</p>}
      {poll?.status === "expired" && <button type="button" className="account-button" onClick={start}>刷新二维码</button>}
    </>}
  </div>;
}
