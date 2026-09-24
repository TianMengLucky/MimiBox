import { Box } from "@apvee/react-layout-kit";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Tooltip } from "@heroui/react";
import { Icon } from "@iconify/react";
import { pluginInvoke } from "../lib/tauriInvoke";
import { createFileRoute } from "@tanstack/react-router";
import { LoginPanel, PlatformMark } from "@components/account/login";
import { PageLoading } from "@components/screen/PageLoading";

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

/**
 * 账号页外壳：全屏、垂直居中、隐藏溢出。结构布局由 layout-kit 提供；
 * padding 及其视口媒体查询自适应（窄窗/矮窗）保留在 account.css——
 * kit 断点按容器宽度解析，无法表达视口高度类规则。
 */
function AccountPageShell({ children }: { children: ReactNode }) {
  return (
    <Box
      asChild
      $minHeight="100dvh"
      $height="100dvh"
      $display="flex"
      $flexDirection="column"
      $alignItems="center"
      $justifyContent="center"
      $overflow="hidden"
    >
      <main className="account-page page-in">{children}</main>
    </Box>
  );
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
      pluginInvoke<AccountStatus>("account", "account_get_status"),
      pluginInvoke<AccountEntry[]>("account", "account_list"),
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
      <AccountPageShell>
        <PageLoading label={error || "正在加载…"} />
      </AccountPageShell>
    );
  }

  // 未保存任何账号且未登录：直接展示登录面板
  if (!status.loggedIn && accounts.length === 0) {
    return (
      <AccountPageShell>
        <LoginPanel onLoggedIn={refresh} />
        {error && <p className="account-error">{error}</p>}
      </AccountPageShell>
    );
  }

  if (mode === "add") {
    return (
      <AccountPageShell>
        <LoginPanel
          onLoggedIn={() => {
            setMode("manage");
            refresh();
          }}
          onCancel={() => setMode("manage")}
        />
        {error && <p className="account-error">{error}</p>}
      </AccountPageShell>
    );
  }

  return (
    <AccountPageShell>
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
                        pluginInvoke("account", "account_switch", { mid: entry.dedeUserId }),
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
                const cookie = await pluginInvoke<string>("account", "account_copy_cookie");
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
                  ? pluginInvoke("account", "douyin_open_web")
                  : pluginInvoke("account", "account_open_web"),
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
              runAction(() => pluginInvoke("account", "account_logout"));
            }}
          >
            退出登录
          </button>
        </div>
      )}
    </AccountPageShell>
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
