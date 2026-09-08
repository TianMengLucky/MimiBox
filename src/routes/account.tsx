import { useCallback, useEffect, useRef, useState } from "react";
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

type LoginTab = "qr" | "sms" | "password";

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
  const [error, setError] = useState("");

  const refreshStatus = useCallback(() => {
    setError("");
    invoke<AccountStatus>("account_get_status")
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(refreshStatus, [refreshStatus]);

  if (status === null) {
    return (
      <main className="account-page">
        <p className="account-loading">{error || "正在加载…"}</p>
      </main>
    );
  }

  return (
    <main className="account-page">
      {status.loggedIn ? (
        <section className="account-card account-card--profile">
          <img
            className="account-avatar"
            src={status.face ?? undefined}
            alt=""
            aria-hidden="true"
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden";
            }}
          />
          <h1 className="account-name">{status.uname}</h1>
          <p className="account-mid">UID：{status.mid}</p>
          <button
            type="button"
            className="account-button account-button--ghost"
            onClick={async () => {
              try {
                await invoke("account_logout");
                refreshStatus();
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            退出登录
          </button>
        </section>
      ) : (
        <LoginPanel onLoggedIn={refreshStatus} />
      )}
    </main>
  );
}

function LoginPanel({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [tab, setTab] = useState<LoginTab>("qr");
  return (
    <section className="account-card account-card--login">
      <h1 className="account-title">登录账号</h1>
      <p className="account-hint">你还没有登录，登录后才能使用账号相关功能。</p>

      <nav className="account-tabs" aria-label="登录方式">
        {(["qr", "sms", "password"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={tab === value ? "account-tab--active" : ""}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => setTab(value)}
          >
            {{ qr: "扫码登录", sms: "短信登录", password: "账号登录" }[value]}
          </button>
        ))}
      </nav>
      {tab === "qr" && <QrLogin onLoggedIn={onLoggedIn} />}
      {tab === "sms" && <SmsLogin onLoggedIn={onLoggedIn} />}
      {tab === "password" && <PasswordLogin onLoggedIn={onLoggedIn} />}
    </section>
  );
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

function PasswordLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const login = async () => {
    if (!captcha || busy) return;
    setBusy(true);
    setError("");
    try {
      await invoke("account_password_login", { username, password, ...captcha });
      onLoggedIn();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  return <div className="account-form"><label className="account-field"><span>账号</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label><label className="account-field"><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><Geetest onVerified={setCaptcha} />{error && <p className="account-error">{error}</p>}<button type="button" className="account-button" disabled={busy || !captcha || !username.trim() || !password} onClick={login}>{busy ? "登录中…" : "登录"}</button></div>;
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
