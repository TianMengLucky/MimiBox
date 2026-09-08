import { useId, useState, type ReactNode } from "react";
import { Button, ButtonGroup } from "@heroui/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

type DockPath = "/home" | "/about" | "/feedback" | "/settings" | "/account";

type DockAction = {
  key: string;
  label: string;
  to: DockPath;
  icon: ReactNode;
};

const actions: DockAction[] = [
  {
    key: "about",
    label: "关于",
    to: "/about",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" width="20" height="20">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
    ),
  },
  {
    key: "feedback",
    label: "反馈",
    to: "/feedback",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="20" height="20">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transform: open ? "rotate(180deg)" : "none",
        transition: "transform 0.2s ease",
      }}
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function CornerDock({
  onActivePress,
  highlight = true,
}: {
  /** 点击“已高亮（当前路径）”的导航按钮时触发（进入/退出极简模式） */
  onActivePress?: () => void;
  /** 是否显示当前路径高亮（极简模式下为 false） */
  highlight?: boolean;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  // 当前路径：用于判断哪些导航按钮处于激活态
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  /** 统一的点击行为：已在目标页则切换（极简模式），否则导航过去 */
  const handleNav = (target: DockPath) => {
    if (pathname === target) onActivePress?.();
    else navigate({ to: target });
  };

  return (
    <div className="corner-dock">
      <div
        id={menuId}
        role="group"
        aria-label="更多操作"
        className={`dock-menu${open ? " dock-menu--open" : ""}`}
        aria-hidden={!open}
      >
        <ButtonGroup
          orientation="vertical"
          variant="tertiary"
          className="dock-menu__group"
        >
          {actions.map((action) => (
            <Button
              key={action.key}
              isIconOnly
              aria-label={action.label}
              aria-current={highlight && pathname === action.to ? "page" : undefined}
              aria-hidden={!open ? true : undefined}
              className={
                highlight && pathname === action.to
                  ? "dock-menu__item dock-menu__item--active"
                  : "dock-menu__item"
              }
              onPress={() => handleNav(action.to)}
            >
              {action.icon}
            </Button>
          ))}
        </ButtonGroup>
      </div>
      <ButtonGroup
        orientation="vertical"
        variant="tertiary"
        className="nav-group"
      >
        <Button
          isIconOnly
          aria-label={open ? "收起更多按钮" : "展开更多按钮"}
          aria-expanded={open}
          aria-controls={menuId}
          className="dock-more"
          onPress={() => setOpen((v) => !v)}
        >
          <ChevronIcon open={open} />
        </Button>
        <Button
          isIconOnly
          aria-label="主页"
          aria-current={highlight && pathname === "/home" ? "page" : undefined}
          className={
            highlight && pathname === "/home" ? "dock-nav--active" : undefined
          }
          onPress={() => handleNav("/home")}
        >
          <HomeIcon />
        </Button>
        <Button
          isIconOnly
          aria-label="账号"
          aria-current={highlight && pathname === "/account" ? "page" : undefined}
          className={
            highlight && pathname === "/account" ? "dock-nav--active" : undefined
          }
          onPress={() => handleNav("/account")}
        >
          <AccountIcon />
        </Button>
        <Button
          isIconOnly
          aria-label="设置"
          aria-current={highlight && pathname === "/settings" ? "page" : undefined}
          className={
            highlight && pathname === "/settings" ? "dock-nav--active" : undefined
          }
          onPress={() => handleNav("/settings")}
        >
          <SettingsIcon />
        </Button>
      </ButtonGroup>
    </div>
  );
}
