import { useEffect, useState } from "react";

/** 日期/时间格式化器提为模块级：构造 Intl.DateTimeFormat 较重，不能每次渲染重建 */
const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** 屏保（闲置触发）：全屏钟面，中央显示大字日期与时间 */
export function Screensaver() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // 钟面秒级显示，1s 足够（更小的间隔只会徒增重渲染）
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateText = dateFormat.format(now);
  const timeText = timeFormat.format(now);

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
