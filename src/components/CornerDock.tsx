import { useId, useState, type ReactNode } from "react";
import { Button, ButtonGroup } from "@heroui/react";
import { Icon } from "@iconify/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

type DockPath =
  | "/home"
  | "/library"
  | "/about"
  | "/feedback"
  | "/settings"
  | "/account";

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
    icon: <Icon icon="lucide:circle-help" width="20" height="20" aria-hidden="true" />,
  },
  {
    key: "feedback",
    label: "反馈",
    to: "/feedback",
    icon: <Icon icon="lucide:message-square" width="20" height="20" aria-hidden="true" />,
  },
];

function ChevronIcon({ open }: { open: boolean }) {
  return <Icon icon="lucide:chevron-up" width="14" height="14" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s ease" }} />;
}

function HomeIcon() {
  return <Icon icon="lucide:house" width="20" height="20" aria-hidden="true" />;
}

function LibraryIcon() {
  return <Icon icon="lucide:library" width="20" height="20" aria-hidden="true" />;
}

function AccountIcon() {
  return <Icon icon="lucide:user-round" width="20" height="20" aria-hidden="true" />;
}

function SettingsIcon() {
  return <Icon icon="lucide:settings" width="20" height="20" aria-hidden="true" />;
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
          aria-label="资料库"
          aria-current={highlight && pathname === "/library" ? "page" : undefined}
          className={
            highlight && pathname === "/library" ? "dock-nav--active" : undefined
          }
          onPress={() => handleNav("/library")}
        >
          <LibraryIcon />
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
