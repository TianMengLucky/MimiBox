/**
 * 功能卡片（主页功能列表）。
 * 统一渲染为按钮：
 * - 功能卡片：传入 onPress 即可点击（悬浮上浮 + 粉色描边）；
 * - 占位卡片：placeholder 为 true 时为禁用态（半透明毛玻璃、无悬浮动效）。
 */
export default function FeatureCard({
  title,
  emoji = "✦",
  description,
  placeholder = false,
  onPress,
}: {
  /** 卡片标题 */
  title: string;
  /** 顶部 emoji 图标 */
  emoji?: string;
  /** 可选的副标题描述 */
  description?: string;
  /** 是否为占位（敬请期待）卡片 */
  placeholder?: boolean;
  /** 点击回调 */
  onPress?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={placeholder}
      aria-label={placeholder ? "敬请期待" : undefined}
      className={
        placeholder ? "home-card home-card--placeholder" : "home-card cursor-pointer"
      }
    >
      <span className="home-card__emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="home-card__title">{title}</span>
      {description ? <span className="home-card__desc">{description}</span> : null}
    </button>
  );
}
