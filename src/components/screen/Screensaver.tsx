import { useEffect, useState } from "react";

/** 屏保（闲置触发）：全屏钟面，中央显示大字日期与时间 */
export function Screensaver() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 250);
    return () => clearInterval(timer);
  }, []);

  const dateText = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
  const timeText = now.toLocaleTimeString("zh-CN", { hour12: false });

  return (
    <main className="screensaver" aria-label="屏保">
      <time className="screensaver__date" dateTime={now.toISOString()}>
        {dateText}
      </time>
      <time className="screensaver__time" dateTime={now.toISOString()}>
        {timeText}
      </time>
      <p className="screensaver__hint">点击任意位置或按键返回</p>
    </main>
  );
}
