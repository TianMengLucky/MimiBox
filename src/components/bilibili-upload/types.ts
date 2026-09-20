/** 投稿分区（子分区，提交稿件用的 tid 即子分区 id） */
export interface UploadZone {
  tid: number;
  name: string;
}

/** 投稿分区树（一级分区 + 子分区） */
export interface UploadZoneMain {
  tid: number;
  name: string;
  children: UploadZone[];
}

/** 视频文件探测结果 */
export interface VideoFileInfo {
  name: string;
  size: number;
}

/** 上传进度事件负载（Rust 事件 bilibili-upload-progress） */
export interface UploadProgress {
  phase: "preupload" | "uploading" | "merging";
  uploaded: number;
  total: number;
}

/** 投稿成功结果 */
export interface SubmitOutcome {
  aid: number;
  bvid: string;
}
