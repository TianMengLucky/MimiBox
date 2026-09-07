import appIcon from "@assets/app-icon.png";

/** 敬请期待：主页占位画面 */
export default function ComingSoon() {
  return (
    <main className="home">
      <img src={appIcon} alt="" className="home__icon" aria-hidden="true" />
      <h1 className="home__title">美美工具箱</h1>
      <p className="home__hint">这里还什么都没有，敬请期待。</p>
    </main>
  );
}
