"use no memo";

import { useCallback, useEffect, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import { Icon } from "@iconify/react";
import { useNavigate } from "@tanstack/react-router";
import { errorMessage } from "@lib/errors";
import { useDanmakuFeed } from "./useDanmakuFeed";
import type { DanmakuRoom, DanmakuStatus } from "./types";
import type { AccountEntry, DanmakuApi } from "./api";

/** 连接状态的展示文案与状态点颜色（与弹幕窗口一致） */
const STATE_META: Record<
  DanmakuStatus["state"],
  { label: string; dot: string }
> = {
  connecting: { label: "连接中…", dot: "bg-[#f0b95e]" },
  connected: { label: "已连接", dot: "bg-[#52c41a]" },
  reconnecting: { label: "重连中…", dot: "bg-[#f0b95e]" },
  disconnected: { label: "未连接", dot: "bg-[#c4b3ba]" },
};

/** 弹幕直播姬功能页：选账号、开窗、连接/断开（数据经 api 走插件上下文） */
export default function DanmakuPage({ api }: { api: DanmakuApi }) {
  const navigate = useNavigate();
  const { status } = useDanmakuFeed(api);
  const [accounts, setAccounts] = useState<AccountEntry[] | null>(null);
  const [accountsError, setAccountsError] = useState("");
  const [selectedMid, setSelectedMid] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [room, setRoom] = useState<DanmakuRoom | null>(null);

  const state = status?.state ?? "disconnected";
  const meta = STATE_META[state];
  const busy = state === "connecting" || state === "reconnecting";

  // 账号列表只拉一次；默认选中当前活动账号
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const list = await api.listAccounts();
        if (disposed) return;
        const bilibili = list.filter((entry) => entry.platform === "bilibili");
        setAccounts(bilibili);
        setSelectedMid(
          (prev) => prev ?? bilibili.find((entry) => entry.active)?.dedeUserId ?? null,
        );
      } catch (err) {
        if (!disposed) setAccountsError(errorMessage(err));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [api]);

  /** 打开弹幕窗口并连接所选账号的直播间 */
  const start = useCallback(async () => {
    if (!selectedMid) return;
    setStarting(true);
    setActionError("");
    try {
      await api.openWindow();
      const info = await api.connect(selectedMid);
      setRoom(info);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }, [api, selectedMid]);

  const stop = useCallback(async () => {
    setActionError("");
    try {
      await api.disconnect();
      setRoom(null);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }, [api]);

  const showRoom = room ?? (status?.roomTitle ? { title: status.roomTitle } : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header>
        <h1 className="m-0 flex items-center gap-2 text-xl font-extrabold tracking-tight text-[#66535a]">
          弹幕直播姬
        </h1>
        <p className="m-0 mt-1 text-sm text-[#9b8a91]">
          连接你的 B 站直播间，弹幕会在独立小窗里以二次元风格滚动展示，适合摆在 OBS
          或录屏旁边。
        </p>
      </header>

      {accountsError ? (
        <p className="m-0 rounded-2xl bg-white/60 px-4 py-3 text-sm text-[#c0566f]">
          账号列表获取失败：{accountsError}
        </p>
      ) : null}

      {/* 账号选择 */}
      <section aria-label="选择账号" className="flex flex-col gap-2">
        <h2 className="m-0 text-sm font-bold text-[#66535a]">连接哪个账号的直播间？</h2>
        {accounts === null && !accountsError ? (
          <div className="flex items-center gap-2 py-4 text-sm text-[#9b8a91]">
            <Spinner size="sm" color="accent" /> 正在获取账号列表…
          </div>
        ) : null}
        {accounts !== null && accounts.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-2xl border border-white/60 bg-white/55 px-4 py-4 text-sm text-[#9b8a91]">
            <span>还没有登录 B 站账号，先去账号页登录一个吧。</span>
            <Button
              variant="primary"
              size="sm"
              className="rounded-full px-4 font-semibold"
              onPress={() => navigate({ to: "/account" })}
            >
              <Icon icon="lucide:user-round" width="15" height="15" aria-hidden="true" />
              去账号页
            </Button>
          </div>
        ) : null}
        {accounts !== null && accounts.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0" role="radiogroup" aria-label="B 站账号">
            {accounts.map((entry) => (
              <li key={entry.dedeUserId}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedMid === entry.dedeUserId}
                  onClick={() => setSelectedMid(entry.dedeUserId)}
                  className={
                    selectedMid === entry.dedeUserId
                      ? "flex w-full items-center gap-3 rounded-2xl border border-[#f6a8c5] bg-white px-3.5 py-2.5 text-left shadow-[0_4px_14px_rgb(251_114_153/18%)]"
                      : "flex w-full items-center gap-3 rounded-2xl border border-white/55 bg-white/50 px-3.5 py-2.5 text-left hover:border-white/80 hover:bg-white/70"
                  }
                >
                  <span
                    aria-hidden="true"
                    className={
                      selectedMid === entry.dedeUserId
                        ? "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border-[5px] border-[#fb7299] bg-white"
                        : "h-4.5 w-4.5 shrink-0 rounded-full border-2 border-[#d8c7cf] bg-white"
                    }
                  />
                  {entry.face ? (
                    <img
                      src={entry.face}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-full bg-[#f6e3ec] object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f6e3ec] text-[#c77f9d]">
                      <Icon icon="lucide:user-round" width="16" height="16" aria-hidden="true" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-[#66535a]">
                      {entry.uname ?? `账号 ${entry.dedeUserId}`}
                    </span>
                    {entry.credentialStatus === "expired" ? (
                      <span className="block text-xs text-[#c0566f]">登录已过期，请重新登录</span>
                    ) : (
                      <span className="block text-xs text-[#9b8a91]">UID {entry.dedeUserId}</span>
                    )}
                  </span>
                  {entry.active ? (
                    <span className="shrink-0 rounded-full bg-[#fde3ed] px-2 py-0.5 text-[11px] font-bold text-[#d9538a]">
                      当前使用
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* 启动 / 断开 + 状态 */}
      <div className="flex flex-wrap items-center gap-2">
        {busy || state === "connected" ? (
          <Button
            variant="tertiary"
            className="rounded-full bg-white/60 px-5 font-semibold text-[#66535a] hover:text-[#c0566f]"
            isDisabled={starting}
            onPress={() => void stop()}
          >
            <Icon icon="lucide:circle-stop" width="16" height="16" aria-hidden="true" />
            断开连接
          </Button>
        ) : null}
        {state === "disconnected" ? (
          <Button
            variant="primary"
            className="rounded-full px-5 font-semibold"
            isDisabled={!selectedMid || starting}
            onPress={() => void start()}
          >
            {starting ? (
              <Spinner size="sm" color="current" />
            ) : (
              <Icon icon="lucide:radio-tower" width="16" height="16" aria-hidden="true" />
            )}
            打开弹幕姬窗口
          </Button>
        ) : null}
        <span className="flex items-center gap-1.5 text-sm font-semibold text-[#66535a]">
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden="true" />
          {meta.label}
          {showRoom?.title ? (
            <span className="max-w-56 truncate font-normal text-[#9b8a91]">
              · {showRoom.title}
            </span>
          ) : null}
        </span>
      </div>

      {actionError ? (
        <p className="m-0 rounded-2xl bg-white/60 px-4 py-3 text-sm text-[#c0566f]" role="alert">
          {actionError}
        </p>
      ) : null}
      {room && !room.liveStatus ? (
        <p className="m-0 rounded-2xl bg-white/60 px-4 py-3 text-sm text-[#9b8a91]">
          这个直播间当前没有开播，弹幕服务器已连接，开播后就能收到弹幕。
        </p>
      ) : null}
      {status?.state === "reconnecting" && status.message ? (
        <p className="m-0 rounded-2xl bg-white/60 px-4 py-3 text-sm text-[#c0566f]" role="alert">
          连接中断：{status.message}，正在自动重连…
        </p>
      ) : null}

      <p className="m-auto max-w-md pt-2 text-center text-xs leading-5 text-[#bfa9b2]">
        连接会保持在后台；关掉弹幕窗口不会断开，随时可以从这里重新打开。
      </p>
    </div>
  );
}
