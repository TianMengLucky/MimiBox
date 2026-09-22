//! 本地评论备注（comment_notes.json）：仅本地存储与显示的评论修改与回复。
//!
//! 与 comment_marks.json 同理：评论本体每次从 B 站接口重拉、不落地，本地
//! 数据按全站唯一的 rpid 关联。`edits` 记录对原评论内容的本地覆盖
//! （还原时删除条目）；`replies` 是用户写的本地回复，列表接口返回前按
//! parent_rpid 挂回对应评论。这些修改与回复不会同步到 B 站，只在本地展示。

use std::collections::BTreeMap;

use rand::RngCore as _;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::LocalReply;
use crate::scheme_store;

const FILE: &str = "comment_notes.json";
const LABEL: &str = "本地评论备注数据";

/// 保存到应用数据目录 comment_notes.json 的完整数据
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct CommentNotes {
    /// 评论 rpid → 本地修改后的内容
    #[serde(default)]
    pub edits: BTreeMap<i64, String>,
    /// 本地回复（挂在原评论下方，跨评论平铺存储）
    #[serde(default)]
    pub replies: Vec<StoredReply>,
}

/// 落盘的单条本地回复
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredReply {
    pub id: String,
    pub parent_rpid: i64,
    pub content: String,
    /// 创建时间（Unix 秒）
    pub created_at: i64,
}

/// 读取本地备注（解析失败降级为空数据）
pub(super) fn load_notes(app: &AppHandle) -> CommentNotes {
    scheme_store::load(app, FILE, LABEL).unwrap_or_default()
}

fn save_notes(app: &AppHandle, notes: &CommentNotes) -> Result<(), String> {
    scheme_store::save(app, FILE, LABEL, notes)
}

/// 某条评论的本地修改内容
pub(super) fn edit_for(notes: &CommentNotes, rpid: i64) -> Option<String> {
    notes.edits.get(&rpid).cloned()
}

/// 某条评论的本地回复（按创建时间升序）
pub(super) fn replies_for(notes: &CommentNotes, rpid: i64) -> Vec<LocalReply> {
    let mut replies: Vec<LocalReply> = notes
        .replies
        .iter()
        .filter(|r| r.parent_rpid == rpid)
        .map(|r| LocalReply {
            id: r.id.clone(),
            content: r.content.clone(),
            created_at: r.created_at,
        })
        .collect();
    replies.sort_by_key(|r| r.created_at);
    replies
}

/// 16 位 hex 随机 id
fn new_id() -> String {
    let mut bytes = [0u8; 8];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 设置评论的本地修改；content 为 None 时还原原文
#[tauri::command]
pub fn bilibili_comments_set_edit(
    app: AppHandle,
    rpid: i64,
    content: Option<String>,
) -> Result<(), String> {
    let mut notes = load_notes(&app);
    match content {
        Some(text) => {
            let text = text.trim().to_string();
            if text.is_empty() {
                return Err("修改内容不能为空".to_string());
            }
            notes.edits.insert(rpid, text);
        }
        None => {
            notes.edits.remove(&rpid);
        }
    }
    save_notes(&app, &notes)
}

/// 新增一条本地回复（挂在原评论下方），返回创建好的回复
#[tauri::command]
pub fn bilibili_comments_add_reply(
    app: AppHandle,
    parent_rpid: i64,
    content: String,
) -> Result<LocalReply, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("回复内容不能为空".to_string());
    }
    let mut notes = load_notes(&app);
    let reply = StoredReply {
        id: new_id(),
        parent_rpid,
        content,
        created_at: now_secs(),
    };
    let dto = LocalReply {
        id: reply.id.clone(),
        content: reply.content.clone(),
        created_at: reply.created_at,
    };
    notes.replies.push(reply);
    save_notes(&app, &notes).map(|_| dto)
}

/// 修改一条本地回复的内容
#[tauri::command]
pub fn bilibili_comments_update_reply(
    app: AppHandle,
    id: String,
    content: String,
) -> Result<(), String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("回复内容不能为空".to_string());
    }
    let mut notes = load_notes(&app);
    notes
        .replies
        .iter_mut()
        .find(|r| r.id == id)
        .map(|r| r.content = content)
        .ok_or_else(|| "本地回复不存在，可能已被删除".to_string())?;
    save_notes(&app, &notes)
}

/// 删除一条本地回复
#[tauri::command]
pub fn bilibili_comments_remove_reply(app: AppHandle, id: String) -> Result<(), String> {
    let mut notes = load_notes(&app);
    let before = notes.replies.len();
    notes.replies.retain(|r| r.id != id);
    if notes.replies.len() == before {
        return Err("本地回复不存在，可能已被删除".to_string());
    }
    save_notes(&app, &notes)
}
