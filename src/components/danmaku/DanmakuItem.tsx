import { useState } from "react";
import { Icon } from "@iconify/react";
import { GUARD_BADGES, unameColor, type DanmakuMessage } from "./types";

/** 弹幕行：头像 + 昵称（粉丝牌/舰队徽章）+ 内容，进入时带 slide-in 动画 */
export default function DanmakuItem({ message }: { message: DanmakuMessage }) {
  const [avatarBroken, setAvatarBroken] = useState(false);
  const guard = GUARD_BADGES[message.guard];

  return (
    <li className="danmaku-item flex items-start gap-2.5 rounded-2xl border border-white/70 bg-white/80 px-3 py-2 shadow-[0_2px_10px_rgb(133_77_96/10%)]">
      {message.avatar && !avatarBroken ? (
        <img
          src={message.avatar}
          alt=""
          loading="lazy"
          onError={() => setAvatarBroken(true)}
          className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-[#f6e3ec] object-cover ring-2 ring-[#fbd3e0]"
        />
      ) : (
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f6e3ec] text-sm font-bold text-[#c77f9d] ring-2 ring-[#fbd3e0]"
        >
          {message.uname.slice(0, 1)}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-5">
          {guard ? (
            <span
              className={`danmaku-guard ${guard.className}`}
              title={`舰约用户（${guard.label}）`}
            >
              <Icon icon="lucide:flame" width="10" height="10" aria-hidden="true" />
              {guard.label}
            </span>
          ) : null}
          <span className="max-w-40 truncate font-bold" style={{ color: unameColor(message.uid) }}>
            {message.uname}
          </span>
          {message.medalName ? (
            <span className="danmaku-medal" title={`粉丝牌：${message.medalName}`}>
              {message.medalName}
              {message.medalLevel ? (
                <b className="ml-0.5 font-bold">{message.medalLevel}</b>
              ) : null}
            </span>
          ) : null}
        </p>
        <p className="m-0 mt-0.5 text-sm leading-6 break-words text-[#544450]">{message.text}</p>
      </div>
    </li>
  );
}
