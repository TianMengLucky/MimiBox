import { useCallback, useEffect, useRef, useState } from "react";
import { Tooltip } from "@heroui/react";
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
  const [accounts, setAccounts] = useState<AccountEntry[] | null>(null);
  // manage：账号管理卡片；add：内嵌登录面板添加新账号
  const [mode, setMode] = useState<"manage" | "add">("manage");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
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
                  aria-label={`${entry.uname ?? "哔哩哔哩用户"}，UID ${entry.dedeUserId}${entry.active ? "，当前账号；右键打开账号菜单" : ""}`}
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
                      y: Math.min(event.clientY, window.innerHeight - 52),
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
                      y: Math.min(rect.bottom + 4, window.innerHeight - 52),
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
                    <img
                      className="size-16 rounded-full bg-pink-50 object-cover shadow-[0_6px_18px_rgb(245_179_201_/_35%)] transition-transform group-hover:scale-[1.03]"
                      src={entry.face ?? undefined}
                      alt=""
                      aria-hidden="true"
                      onError={(event) => {
                        event.currentTarget.style.visibility = "hidden";
                      }}
                    />
                    <AccountStatusDot status={entry.credentialStatus} />
                  </span>
                  <span className="w-full truncate text-center text-xs font-semibold text-[#66535a]">
                    {entry.uname ?? "哔哩哔哩用户"}
                  </span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content placement="bottom" className="text-xs">
                UID：{entry.dedeUserId}
              </Tooltip.Content>
            </Tooltip>
          ))}
          <AddAvatarButton busy={busy} onAdd={() => setMode("add")} />
        </div>
        {error && <p className="account-error">{error}</p>}
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
              runAction(() => invoke("account_open_web"));
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
        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 21v-1.5a4.5 4.5 0 0 0-4.5-4.5h-5A4.5 4.5 0 0 0 5 19.5V21" />
          <circle cx="12" cy="7.5" r="4" />
        </svg>
        <span className="absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full border-2 border-white bg-pink-400 text-white">
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
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
