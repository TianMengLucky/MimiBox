//! 评论标记（comment_marks.json）：按评论 rpid 记录被用户标记的评论。
//!
//! 评论每次从 B 站接口重新拉取、不落地，标记状态需单独持久化，以便重新进入
//! 或翻页后仍能看到已标记的评论。rpid 全站唯一，故用扁平集合存储。
//! 列表接口在返回前用 [`load_set`] 注入 `CommentItem::is_marked`，
//! 前端只读该布尔标记做「只看标记」筛选。

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::scheme_store;

const FILE: &str = "comment_marks.json";
const LABEL: &str = "评论标记数据";

/// 保存到应用数据目录 comment_marks.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CommentMarks {
    #[serde(default)]
    pub rpids: Vec<i64>,
}

/// 读取已标记评论的 rpid 集合（解析失败降级为空集合）
pub(super) fn load_set(app: &AppHandle) -> HashSet<i64> {
    let data: CommentMarks = scheme_store::load(app, FILE, LABEL).unwrap_or_default();
    data.rpids.into_iter().collect()
}

/// 设置某条评论的标记状态并持久化
#[tauri::command]
pub fn bilibili_comments_set_mark(app: AppHandle, rpid: i64, marked: bool) -> Result<(), String> {
    let mut data: CommentMarks = scheme_store::load(&app, FILE, LABEL).unwrap_or_default();
    if marked {
        if !data.rpids.contains(&rpid) {
            data.rpids.push(rpid);
        }
    } else {
        data.rpids.retain(|&id| id != rpid);
    }
    scheme_store::save(&app, FILE, LABEL, &data)
}
