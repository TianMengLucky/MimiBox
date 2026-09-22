"use no memo";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Switch, TextArea } from "@heroui/react";
import { Icon } from "@iconify/react";
import { createFileRoute } from "@tanstack/react-router";
import { tauriInvoke, hasTauri } from "../../lib/tauriInvoke";
import { errorMessage } from "../../lib/errors";
import { CategoryPicker } from "@components/bilibili-upload/CategoryPicker";
import { CoverPicker } from "@components/bilibili-upload/CoverPicker";
import { ProgressPanel } from "@components/bilibili-upload/ProgressPanel";
import { TagInput } from "@components/bilibili-upload/TagInput";
import { VideoPicker } from "@components/bilibili-upload/VideoPicker";
import { charCount } from "@components/bilibili-upload/format";
import type {
  SubmitOutcome,
  UploadProgress,
  UploadZoneMain,
  VideoFileInfo,
} from "@components/bilibili-upload/types";

export const Route = createFileRoute("/feature/bilibili-upload")({
  component: BilibiliUploadRoute,
});

type Copyright = 1 | 2;

/** 浏览器预览时的占位分区表（应用内会被真实数据覆盖） */
const DEMO_ZONES: UploadZoneMain[] = [
  {
    tid: 1,
    name: "动画",
    children: [
      { tid: 24, name: "MAD·AMV" },
      { tid: 27, name: "综合" },
    ],
  },
];

function BilibiliUploadRoute() {
  // 表单状态
  const [videoPath, setVideoPath] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoFileInfo | null>(null);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [zones, setZones] = useState<UploadZoneMain[]>(DEMO_ZONES);
  const [mainTid, setMainTid] = useState<number | null>(null);
  const [tid, setTid] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [coverUrl, setCoverUrl] = useState("");
  const [copyright, setCopyright] = useState<Copyright>(1);
  const [source, setSource] = useState("");
  const [noReprint, setNoReprint] = useState(true);
  const [openElec, setOpenElec] = useState(false);
  const [dynamic, setDynamic] = useState("");

  // 任务状态
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);

  // 分区表加载（应用内一次即可）
  useEffect(() => {
    if (!hasTauri) return;
    let disposed = false;
    void tauriInvoke<UploadZoneMain[]>("bilibili_upload_cats")
      .then((data) => {
        if (disposed || data.length === 0) return;
        setZones(data);
        setMainTid(data[0].tid);
        setTid(data[0].children[0]?.tid ?? data[0].tid);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  // 首次拿到分区表时选中第一个子分区
  useEffect(() => {
    if (mainTid === null && zones.length > 0) {
      setMainTid(zones[0].tid);
      setTid(zones[0].children[0]?.tid ?? zones[0].tid);
    }
  }, [mainTid, zones]);

  // 上传进度事件（仅提交期间监听）
  const submittingRef = useRef(submitting);
  submittingRef.current = submitting;
  useEffect(() => {
    if (!hasTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (disposed) return;
      const off = await listen<UploadProgress>("bilibili-upload-progress", (event) => {
        if (submittingRef.current) setProgress(event.payload);
      });
      if (disposed) off();
      else unlisten = off;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const submit = useCallback(async () => {
    if (!videoPath || !tid) return;
    setSubmitting(true);
    setError("");
    setOutcome(null);
    setProgress({ phase: "preupload", uploaded: 0, total: videoInfo?.size ?? 0 });
    try {
      const result = await tauriInvoke<SubmitOutcome>("bilibili_upload_start", {
        params: {
          videoPath,
          title: title.trim(),
          desc: desc.trim(),
          tid,
          tags,
          copyright,
          source: source.trim(),
          cover: coverUrl,
          noReprint,
          openElec,
          dynamic: dynamic.trim(),
        },
      });
      setOutcome(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }, [videoPath, videoInfo, tid, title, desc, tags, copyright, source, coverUrl, noReprint, openElec, dynamic]);

  const cancel = useCallback(() => {
    void tauriInvoke("bilibili_upload_cancel").catch(() => {});
  }, []);

  const canSubmit =
    !submitting &&
    !!videoPath &&
    title.trim().length > 0 &&
    tags.length > 0 &&
    tid !== null &&
    (copyright === 1 || source.trim().length > 0);

  const reset = () => {
    setOutcome(null);
    setVideoPath("");
    setVideoInfo(null);
    setTitle("");
    setDesc("");
    setTags([]);
    setCoverUrl("");
    setSource("");
    setDynamic("");
    setError("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {outcome ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Icon icon="lucide:party-popper" width="44" height="44" aria-hidden="true" className="text-[#d26d9a]" />
          <h2 className="m-0 text-lg font-extrabold text-[#66535a]">投稿成功！</h2>
          <p className="m-0 text-sm text-[#9b8a91]">
            稿件 {outcome.bvid} 已进入审核队列，通过后即可在主页看到。
          </p>
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              className="rounded-full px-5 font-semibold"
              onPress={() => {
                void import("@tauri-apps/plugin-opener").then(({ openUrl }) =>
                  openUrl(`https://www.bilibili.com/video/${outcome.bvid}`).catch(() => {}),
                );
              }}
            >
              <Icon icon="lucide:play" width="15" height="15" aria-hidden="true" />
              打开稿件页
            </Button>
            <Button variant="tertiary" size="sm" className="rounded-full px-5 font-semibold" onPress={reset}>
              再投一个
            </Button>
          </div>
        </div>
      ) : (
        <>
          <header>
            <h1 className="m-0 flex items-center gap-2 text-xl font-extrabold tracking-tight text-[#66535a]">
              B站投稿
            </h1>
            <p className="m-0 mt-1 text-sm text-[#9b8a91]">
              选择视频一键投稿到你的 B 站账号，上传进度实时可见。
            </p>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <VideoPicker
              disabled={submitting}
              info={videoInfo}
              onPicked={(path, info) => {
                setVideoPath(path);
                setVideoInfo(info);
                if (!title.trim()) setTitle(info.name.replace(/\.[^.]+$/, ""));
              }}
              onCleared={() => {
                setVideoPath("");
                setVideoInfo(null);
              }}
            />

            <section aria-label="基本信息" className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-bold text-[#66535a]">
                  标题 <span aria-hidden="true" className="text-[#d26d9a]">*</span>
                </span>
                <span className="ml-auto text-xs text-[#bfa9b2]" aria-live="polite">
                  {charCount(title)} / 80
                </span>
              </div>
              <Input
                aria-label="稿件标题"
                placeholder="给稿件起个响亮的标题…"
                variant="secondary"
                value={title}
                disabled={submitting}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
              />

              <div className="flex items-baseline gap-2 pt-1">
                <span className="text-sm font-bold text-[#66535a]">简介</span>
                <span className="ml-auto text-xs text-[#bfa9b2]" aria-live="polite">
                  {charCount(desc)} / 2000
                </span>
              </div>
              <TextArea
                aria-label="稿件简介"
                placeholder="和观众说点什么…"
                variant="secondary"
                className="h-24 w-full"
                value={desc}
                disabled={submitting}
                onChange={(event) => setDesc(event.target.value)}
              />
            </section>

            <section aria-label="分区与标签" className="flex flex-col gap-2">
              <p className="m-0 text-sm font-bold text-[#66535a]">
                分区 <span aria-hidden="true" className="text-[#d26d9a]">*</span>
              </p>
              <CategoryPicker
                zones={zones}
                mainTid={mainTid}
                tid={tid}
                disabled={submitting}
                onMainChange={setMainTid}
                onTidChange={setTid}
              />

              <p className="m-0 pt-1 text-sm font-bold text-[#66535a]">
                标签 <span aria-hidden="true" className="text-[#d26d9a]">*</span>
              </p>
              <TagInput tags={tags} disabled={submitting} onChange={setTags} />
            </section>

            <section aria-label="封面" className="flex flex-col gap-2">
              <p className="m-0 text-sm font-bold text-[#66535a]">封面</p>
              <CoverPicker
                disabled={submitting}
                coverUrl={coverUrl}
                onUploaded={setCoverUrl}
                onCleared={() => setCoverUrl("")}
              />
            </section>

            <section aria-label="稿件类型" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="稿件类型">
                {(
                  [
                    { value: 1 as Copyright, label: "自制" },
                    { value: 2 as Copyright, label: "转载" },
                  ] as const
                ).map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    disabled={submitting}
                    aria-pressed={copyright === value}
                    className={
                      copyright === value
                        ? "flex items-center gap-1.5 rounded-full border border-white/70 bg-white px-4 py-1.5 text-sm font-bold text-[#66535a] shadow-[0_2px_8px_rgb(133_77_96/14%)]"
                        : "flex items-center gap-1.5 rounded-full border border-white/55 bg-white/45 px-4 py-1.5 text-sm font-semibold text-[#9b8a91] transition-colors hover:text-[#66535a] disabled:cursor-default disabled:opacity-50"
                    }
                    onClick={() => setCopyright(value)}
                  >
                    <Icon
                      icon={value === 1 ? "lucide:sparkles" : "lucide:link"}
                      width="14"
                      height="14"
                      aria-hidden="true"
                    />
                    {label}
                  </button>
                ))}
              </div>
              {copyright === 2 && (
                <Input
                  aria-label="转载来源"
                  placeholder="转载来源地址（必填，如原视频链接）"
                  variant="secondary"
                  value={source}
                  disabled={submitting}
                  onChange={(event) => setSource(event.target.value)}
                />
              )}
              <div className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
                <Switch isSelected={noReprint} isDisabled={submitting} onChange={setNoReprint}>
                  <Switch.Content>
                    <span className="text-sm font-semibold text-[#66535a]">声明禁止转载</span>
                  </Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
                <Switch isSelected={openElec} isDisabled={submitting} onChange={setOpenElec}>
                  <Switch.Content>
                    <span className="text-sm font-semibold text-[#66535a]">开启充电</span>
                  </Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              </div>
              <Input
                aria-label="粉丝动态"
                placeholder="粉丝动态（可选，发布后自动发一条动态）"
                variant="secondary"
                value={dynamic}
                disabled={submitting}
                onChange={(event) => setDynamic(event.target.value)}
              />
            </section>

            {progress && <ProgressPanel progress={progress} onCancel={cancel} />}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-2xl border border-[#f3c4d8] bg-[#fff1f7]/70 px-4 py-3"
              >
                <Icon icon="lucide:circle-off" width="16" height="16" aria-hidden="true" className="mt-0.5 shrink-0 text-[#c25582]" />
                <p className="m-0 text-sm break-all text-[#c25582]">{error}</p>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <Button
                variant="primary"
                size="md"
                isDisabled={!canSubmit}
                className="rounded-full px-8 font-bold"
                onPress={() => void submit()}
              >
                <Icon icon="simple-icons:bilibili" width="17" height="17" aria-hidden="true" />
                {submitting ? "投稿中…" : "投稿"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
