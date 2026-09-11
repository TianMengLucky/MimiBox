import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "@heroui/react";
import { Icon } from "@iconify/react";
import { invoke } from "@tauri-apps/api/core";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/account")({
  component: AccountRoute,
});

interface AccountStatus {
  loggedIn: boolean;
  mid: number | null;
  uname: string | null;
  face: string | null;
}

interface AccountEntry {
  dedeUserId: string;
  platform: "bilibili" | "douyin";
  uname: string | null;
  face: string | null;
  active: boolean;
  credentialStatus: "valid" | "expired" | "unknown";
}

interface QrStart {
  qrImage: string;
  qrcodeKey: string;
}

type QrState = "waiting" | "scanned" | "success" | "expired";

interface QrPoll {
  status: QrState;
  message: string;
}

interface CaptchaInfo {
  token: string;
  gt: string;
  challenge: string;
}

interface CaptchaResult {
  token: string;
  challenge: string;
  validate: string;
  seccode: string;
}

interface SmsSendResult {
  captchaKey: string;
}

type LoginTab = "qr" | "sms";
type LoginPlatform = "bilibili" | "douyin";

interface GeetestValidate {
  geetest_challenge: string;
  geetest_validate: string;
  geetest_seccode: string;
}

interface GeetestInstance {
  appendTo(element: HTMLElement): void;
  onReady(callback: () => void): void;
  onSuccess(callback: () => void): void;
  onError(callback: () => void): void;
  getValidate(): GeetestValidate | false;
  destroy(): void;
}

declare global {
  interface Window {
    initGeetest?: (
      config: Record<string, string | boolean>,
      callback: (instance: GeetestInstance) => void,
    ) => void;
  }
}

const GEETEST_SCRIPT = "https://static.geetest.com/static/tools/gt.js";
let geetestScriptPromise: Promise<void> | undefined;

function loadGeetestScript() {
  if (window.initGeetest) return Promise.resolve();
  if (geetestScriptPromise) return geetestScriptPromise;

  geetestScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GEETEST_SCRIPT}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        reject(new Error("人机验证组件初始化失败"));
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("人机验证组件加载失败")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = GEETEST_SCRIPT;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("人机验证组件加载失败"));
    document.head.appendChild(script);
  });
  return geetestScriptPromise.catch((error) => {
    geetestScriptPromise = undefined;
    throw error;
  });
}

function AccountRoute() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [accounts, setAccounts] = useState<AccountEntry[] | null>(null);
  // manage：账号管理卡片；add：内嵌登录面板添加新账号
  const [mode, setMode] = useState<"manage" | "add">("manage");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 右键菜单里的轻量操作反馈（如"Cookie 已复制"）
  const [notice, setNotice] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    platform: string;
  } | null>(null);

  const refresh = useCallback(() => {
    setError("");
    Promise.all([
      invoke<AccountStatus>("account_get_status"),
      invoke<AccountEntry[]>("account_list"),
    ])
      .then(([nextStatus, list]) => {
        setStatus(nextStatus);
        setAccounts(list);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const runAction = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (status === null || accounts === null) {
    return (
      <main className="account-page">
        <p className="account-loading">{error || "正在加载…"}</p>
      </main>
    );
  }

  // 未保存任何账号且未登录：直接展示登录面板
  if (!status.loggedIn && accounts.length === 0) {
    return (
      <main className="account-page">
        <LoginPanel onLoggedIn={refresh} />
        {error && <p className="account-error">{error}</p>}
      </main>
    );
  }

  if (mode === "add") {
    return (
      <main className="account-page">
        <LoginPanel
          onLoggedIn={() => {
            setMode("manage");
            refresh();
          }}
          onCancel={() => setMode("manage")}
        />
        {error && <p className="account-error">{error}</p>}
      </main>
    );
  }

  return (
    <main className="account-page">
      <section className="account-card !w-[min(460px,100%)]">
        <h1 className="account-title">账号管理</h1>
        <div className="mt-5 flex max-w-full flex-wrap items-start justify-center gap-4">
          {accounts.map((entry) => (
            <Tooltip key={entry.dedeUserId} delay={250}>
              <Tooltip.Trigger>
                <button
                  type="button"
                  className="group flex w-18 flex-col items-center gap-2 border-0 bg-transparent p-0 shadow-none disabled:cursor-default disabled:opacity-55"
                  disabled={busy}
                  aria-current={entry.active ? "true" : undefined}
                  aria-label={`${entry.uname ?? (entry.platform === "douyin" ? "抖音用户" : "哔哩哔哩用户")}，UID ${entry.dedeUserId}${entry.active ? "，当前账号；右键打开账号菜单" : ""}`}
                  onClick={() => {
                    if (!entry.active) {
                      runAction(() =>
                        invoke("account_switch", { mid: entry.dedeUserId }),
                      );
                    }
                  }}
                  onContextMenu={(event) => {
                    if (!entry.active) return;
                    event.preventDefault();
                    setContextMenu({
                      x: Math.min(event.clientX, window.innerWidth - 144),
                      y: Math.min(event.clientY, window.innerHeight - 84),
                      platform: entry.platform,
                    });
                  }}
                  onKeyDown={(event) => {
                    if (
                      !entry.active ||
                      (event.key !== "ContextMenu" &&
                        !(event.shiftKey && event.key === "F10"))
                    ) {
                      return;
                    }
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setContextMenu({
                      x: Math.min(rect.left, window.innerWidth - 144),
                      y: Math.min(rect.bottom + 4, window.innerHeight - 84),
                      platform: entry.platform,
                    });
                  }}
                >
                  <span
                    className={`relative rounded-full p-0.5 ${
                      entry.active
                        ? "ring-2 ring-pink-300 ring-offset-2 ring-offset-white"
                        : "ring-2 ring-transparent ring-offset-2"
                    }`}
                  >
                    {entry.face ? <img
                      className="size-16 rounded-full bg-pink-50 object-cover shadow-[0_6px_18px_rgb(245_179_201_/_35%)] transition-transform group-hover:scale-[1.03]"
                      src={entry.face}
                      alt=""
                      aria-hidden="true"
                    /> : <span className="flex size-16 items-center justify-center rounded-full bg-pink-50 text-[#66535a] shadow-[0_6px_18px_rgb(245_179_201_/_35%)]"><PlatformMark platform={entry.platform} /></span>}
                    <AccountStatusDot status={entry.credentialStatus} />
                  </span>
                  <span className="w-full truncate text-center text-xs font-semibold text-[#66535a]">
                    {entry.uname ?? (entry.platform === "douyin" ? "抖音用户" : "哔哩哔哩用户")}
                  </span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom" className="text-xs">
                <span className="flex flex-col leading-tight">
                  <span>{entry.platform === "douyin" ? "Douyin" : "Bilibili"}</span>
                  <span>{entry.platform === "douyin" ? "抖音号" : "UID"}:{entry.dedeUserId}</span>
                </span>
              </Tooltip.Content>
            </Tooltip>
          ))}
          <AddAvatarButton busy={busy} onAdd={() => setMode("add")} />
        </div>
        {error && <p className="account-error">{error}</p>}
        {!error && notice && <p className="account-error text-emerald-600">{notice}</p>}
      </section>
      {contextMenu && status.loggedIn && (
        <div
          className="fixed z-50 min-w-36 rounded-lg border border-pink-100 bg-white p-1.5 shadow-[0_8px_24px_rgb(102_83_90_/_18%)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="账号菜单"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="w-full rounded-md border-0 bg-transparent px-3 py-2 text-left text-sm font-medium text-[#66535a] shadow-none hover:bg-pink-50 focus-visible:outline-2 focus-visible:outline-pink-400"
            role="menuitem"
            disabled={busy}
            autoFocus
            onClick={() => {
              setContextMenu(null);
              runAction(async () => {
                const cookie = await invoke<string>("account_copy_cookie");
                await navigator.clipboard.writeText(cookie);
                setNotice("Cookie 已复制到剪贴板");
                setTimeout(() => setNotice(""), 2500);
              });
            }}
          >
            复制 Cookie
          </button>
          <button
            type="button"
            className="w-full rounded-md border-0 bg-transparent px-3 py-2 text-left text-sm font-medium text-[#66535a] shadow-none hover:bg-pink-50 focus-visible:outline-2 focus-visible:outline-pink-400"
            role="menuitem"
            disabled={busy}
            autoFocus
            onClick={() => {
              setContextMenu(null);
              runAction(() =>
                contextMenu.platform === "douyin"
                  ? invoke("douyin_open_web")
                  : invoke("account_open_web"),
              );
            }}
          >
            在网页中打开
          </button>
          <div className="my-1 h-px bg-pink-100" role="separator" />
          <button
            type="button"
            className="w-full rounded-md border-0 bg-transparent px-3 py-2 text-left text-sm font-medium text-rose-500 shadow-none hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-rose-400"
            role="menuitem"
            disabled={busy}
            onClick={() => {
              setContextMenu(null);
              runAction(() => invoke("account_logout"));
            }}
          >
            退出登录
          </button>
        </div>
      )}
    </main>
  );
}

function AccountStatusDot({
  status,
}: {
  status: AccountEntry["credentialStatus"];
}) {
  const label = {
    valid: "在线，登录凭证有效",
    expired: "登录凭证已过期",
    unknown: "暂时无法确认登录状态",
  }[status];
  const color = {
    valid: "bg-emerald-500",
    expired: "bg-rose-400",
    unknown: "bg-zinc-400",
  }[status];

  return (
    <span
      className={`absolute right-0 bottom-0 size-3 rounded-full border-2 border-white ${color}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}

function AddAvatarButton({ busy, onAdd }: { busy: boolean; onAdd: () => void }) {
  return (
    <div className="flex w-18 flex-col items-center gap-2">
      <button
        type="button"
        className="relative flex size-16 shrink-0 items-center justify-center rounded-full border border-dashed border-pink-300 bg-pink-50 text-pink-300 shadow-none transition-colors hover:border-pink-400 hover:bg-pink-100 hover:text-pink-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-500 disabled:cursor-default disabled:opacity-55"
        disabled={busy}
        aria-label="添加账号"
        onClick={onAdd}
      >
        <Icon icon="lucide:user-round" className="size-8" aria-hidden="true" />
        <span className="absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full border-2 border-white bg-pink-400 text-white">
          <Icon icon="lucide:plus" className="size-3" aria-hidden="true" />
        </span>
      </button>
      <span className="w-full truncate text-center text-xs font-semibold text-[#9b8a91]">
        添加账号
      </span>
    </div>
  );
}

function LoginPanel({
  onLoggedIn,
  onCancel,
}: {
  onLoggedIn: () => void;
  onCancel?: () => void;
}) {
  const [tab, setTab] = useState<LoginTab>("qr");
  const [platform, setPlatform] = useState<LoginPlatform>("bilibili");
  return (
    <section className="account-card account-card--login">
      <h1 className="account-title">{onCancel ? "添加账号" : "登录账号"}</h1>
      <p className="account-hint">
        {onCancel
          ? "登录成功后会保存到账号列表，可随时切换。"
          : "你还没有登录，登录后才能使用账号相关功能。"}
      </p>
      {onCancel && (
        <button
          type="button"
          className="account-button account-button--ghost"
          onClick={onCancel}
        >
          返回账号列表
        </button>
      )}

      <div className="mt-5 inline-flex items-center rounded-full border border-pink-100 bg-pink-50/80 p-1 shadow-inner" role="group" aria-label="选择平台">
        {(["bilibili", "douyin"] as const).map((value) => {
          const selected = platform === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              aria-label={value === "bilibili" ? "切换到哔哩哔哩登录" : "切换到抖音登录"}
              title={value === "bilibili" ? "哔哩哔哩" : "抖音"}
              onClick={() => { setPlatform(value); setTab("qr"); }}
              className={`flex size-10 items-center justify-center rounded-full border-0 p-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-400 ${selected ? "bg-white text-[#66535a] shadow-[0_2px_8px_rgb(133_77_96_/_14%)]" : "bg-transparent text-[#9b8a91] hover:text-[#66535a]"}`}
            >
              <PlatformMark platform={value} />
            </button>
          );
        })}
      </div>

      {platform === "bilibili" && (
        <nav className="account-tabs" aria-label="登录方式">
          {(["qr", "sms"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={tab === value ? "account-tab--active" : ""}
              aria-current={tab === value ? "page" : undefined}
              onClick={() => setTab(value)}
            >
              {{ qr: "扫码登录", sms: "短信登录" }[value]}
            </button>
          ))}
        </nav>
      )}
      {platform === "bilibili" && tab === "qr" && <QrLogin onLoggedIn={onLoggedIn} />}
      {platform === "bilibili" && tab === "sms" && <SmsLogin onLoggedIn={onLoggedIn} />}
      {platform === "douyin" && <DouyinQrLogin onLoggedIn={onLoggedIn} />}
    </section>
  );
}

function PlatformMark({ platform }: { platform: LoginPlatform }) {
  return <Icon icon={platform === "bilibili" ? "simple-icons:bilibili" : "simple-icons:tiktok"} className="size-6" aria-hidden="true" />;
}

function Geetest({ onVerified }: { onVerified: (result: CaptchaResult) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("正在加载人机验证…");

  useEffect(() => {
    let disposed = false;
    let instance: GeetestInstance | undefined;
    Promise.all([loadGeetestScript(), invoke<CaptchaInfo>("account_captcha")])
      .then(([, info]) => {
        if (disposed || !window.initGeetest || !containerRef.current) return;
        window.initGeetest({ gt: info.gt, challenge: info.challenge, new_captcha: true, offline: false, product: "float", width: "100%", https: true }, (captcha) => {
          if (disposed || !containerRef.current) return captcha.destroy();
          instance = captcha;
          captcha.appendTo(containerRef.current);
          captcha.onReady(() => setMessage("请完成上方人机验证"));
          captcha.onSuccess(() => {
            const value = captcha.getValidate();
            if (!value) return setMessage("验证结果无效，请重试");
            setMessage("验证已通过");
            onVerified({ token: info.token, challenge: value.geetest_challenge, validate: value.geetest_validate, seccode: value.geetest_seccode });
          });
          captcha.onError(() => setMessage("人机验证加载失败，请切换网络后重试"));
        });
      })
      .catch((error) => setMessage(String(error)));
    return () => { disposed = true; instance?.destroy(); };
  }, [onVerified]);

  return <div className="account-captcha"><div ref={containerRef} /><p aria-live="polite">{message}</p></div>;
}

function SmsLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [tel, setTel] = useState("");
  const [code, setCode] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaResult>();
  const [captchaKey, setCaptchaKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!captcha || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await invoke<SmsSendResult>("account_sms_send", { tel, ...captcha });
      setCaptchaKey(result.captchaKey);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await invoke("account_sms_login", { tel, code, captchaKey });
      onLoggedIn();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-form">
      <label className="account-field"><span>手机号</span><input inputMode="tel" autoComplete="tel" value={tel} onChange={(event) => setTel(event.target.value)} /></label>
      <Geetest onVerified={setCaptcha} />
      <button type="button" className="account-button" disabled={busy || !captcha || !tel.trim()} onClick={send}>{busy ? "请稍候…" : "发送短信"}</button>
      {captchaKey && <><label className="account-field"><span>短信验证码</span><input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} /></label><button type="button" className="account-button" disabled={busy || !code.trim()} onClick={login}>{busy ? "登录中…" : "登录"}</button></>}
      {error && <p className="account-error">{error}</p>}
    </div>
  );
}

interface DouyinQrStart { qrImage: string }
interface DouyinQrPoll {
  status: "waiting" | "scanned" | "success" | "expired" | "verification_required" | "verification_unsupported";
  message: string;
  /** 过期无感换码：新二维码图片（data URI） */
  newQrImage?: string;
  /** 扫码二次验证：脱敏手机号（可能为 null） */
  mobile?: string | null;
}

function DouyinQrLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
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
    invoke("douyin_reset_session").catch(() => undefined).finally(() => {
      invoke<DouyinQrStart>("douyin_qr_start")
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

        const result = await invoke<DouyinQrPoll>("douyin_qr_poll");
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
      await invoke("douyin_qr_sms_validate", { code: value });
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
      const result = await invoke<{ mobile: string | null }>("douyin_qr_sms_send");
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

function QrLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [qr, setQr] = useState<QrStart | null>(null);
  const [poll, setPoll] = useState<QrPoll | null>(null);
  const [error, setError] = useState("");
  const start = useCallback(() => {
    setError("");
    setPoll(null);
    invoke<QrStart>("account_qr_start")
      .then((data) => {
        setQr(data);
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(start, [start]);

  // 轮询扫码状态：成功/过期后停止
  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    let timer: number | undefined;
    const pollStatus = async () => {
      try {
        const data = await invoke<QrPoll>("account_qr_poll", {
          qrcodeKey: qr.qrcodeKey,
        });
        if (stopped) return;
        setPoll(data);
        if (data.status === "success") {
          onLoggedIn();
        } else if (data.status !== "expired") {
          timer = window.setTimeout(pollStatus, 2000);
        }
      } catch (e) {
        if (stopped) return;
        setError(String(e));
      }
    };
    timer = window.setTimeout(pollStatus, 2000);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [qr, onLoggedIn]);

  if (error) {
    return (
      <div className="account-qr">
        <p className="account-error">{error}</p>
        <button type="button" className="account-button" onClick={start}>
          重新加载二维码
        </button>
      </div>
    );
  }

  return (
    <div className="account-qr">
      {qr ? (
        <img className="account-qr__image" src={qr.qrImage} alt="登录二维码" />
      ) : (
        <div className="account-qr__placeholder">正在生成二维码…</div>
      )}
      <p className="account-qr__status" aria-live="polite">
        {poll
          ? poll.message
          : "请使用哔哩哔哩 App 扫一扫，扫描后请在手机上确认。"}
      </p>
      {poll?.status === "expired" && (
        <button type="button" className="account-button" onClick={start}>
          刷新二维码
        </button>
      )}
    </div>
  );
}
