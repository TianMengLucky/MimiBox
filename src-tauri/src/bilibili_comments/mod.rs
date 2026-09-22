//! B 站评论区功能：获取当前登录账号的视频列表与指定视频的评论。

pub(crate) mod marks;
pub(crate) mod notes;
mod spam;
mod wbi;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::account::AccountState;

/// Chrome 137 UA（与协议 profile 保持一致），B 站功能模块共享
pub(crate) const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSummary {
    pub aid: i64,
    pub bvid: String,
    pub title: String,
    pub cover: String,
    /// 发布时间（Unix 秒）
    pub created: i64,
    /// 时长文本，如 "12:34"
    pub duration: String,
    pub play: i64,
    pub comment: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideosPage {
    pub videos: Vec<VideoSummary>,
    pub page: u32,
    pub page_count: u32,
    pub total: u32,
}

/// 仅本地存储与显示的评论回复（comment_notes.json），挂在原评论下方
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalReply {
    pub id: String,
    pub content: String,
    /// 创建时间（Unix 秒）
    pub created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentItem {
    pub rpid: i64,
    pub mid: u64,
    pub uname: String,
    pub avatar: String,
    pub level: i32,
    pub content: String,
    pub likes: i64,
    /// 发布时间（Unix 秒）
    pub ctime: i64,
    pub is_top: bool,
    /// 是否灌水评论（纯表情/复读/口癖），由 spam 模块在解析时计算
    pub is_spam: bool,
    /// 是否被用户标记，由 marks 持久化数据在返回前注入
    pub is_marked: bool,
    /// 本地修改后的内容（仅本地存储与显示），None 表示未修改
    pub local_edit: Option<String>,
    /// 本地回复（仅本地存储与显示），按创建时间升序由 notes 注入
    pub replies: Vec<LocalReply>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentsPage {
    pub comments: Vec<CommentItem>,
    pub total: u32,
    pub has_more: bool,
    /// 时间排序（mode=2）的翻页游标：来自 cursor.pagination_reply.next_offset，
    /// 下一次请求需原样回传；为空表示没有下一页
    pub next_offset: Option<String>,
}

#[derive(Deserialize)]
struct ApiEnvelope {
    code: i64,
    message: String,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

/// 去掉搜索接口在标题里插入的 <em class="keyword"> 高亮标签
fn strip_em_tags(text: &str) -> String {
    text.replace("<em class=\"keyword\">", "")
        .replace("</em>", "")
}

/// 带 WBI 签名请求 api.bilibili.com 的 JSON 接口
async fn wbi_get(
    state: &AccountState,
    cookie: Option<&str>,
    url: &str,
    params: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let mixin = wbi::mixin_key(state.http(), cookie, UA).await?;
    let query = wbi::signed_query(params, &mixin);
    let mut request = state
        .http()
        .get(format!("{url}?{query}"))
        .header(reqwest::header::USER_AGENT, UA)
        .header(reqwest::header::REFERER, "https://www.bilibili.com/")
        .header(reqwest::header::ACCEPT, "application/json");
    if let Some(cookie) = cookie {
        request = request.header(reqwest::header::COOKIE, cookie);
    }
    let envelope: ApiEnvelope = request
        .send()
        .await
        .map_err(|e| format!("请求 B 站接口失败: {e}"))?
        .json()
        .await
        .map_err(|e| format!("解析 B 站响应失败: {e}"))?;
    if envelope.code != 0 {
        return Err(format!("{} ({})", envelope.message, envelope.code));
    }
    envelope.data.ok_or_else(|| "接口响应缺少数据".to_string())
}

/// 当前登录账号的视频投稿列表（分页，每页 30 条）
#[tauri::command]
pub async fn bilibili_comments_videos(
    app: AppHandle,
    state: State<'_, AccountState>,
    page: u32,
) -> Result<VideosPage, String> {
    let (mid, cookie) = state
        .bilibili_session(&app)?
        .ok_or_else(|| "请先在账号页登录 B 站账号".to_string())?;
    let page = page.max(1);
    let data = wbi_get(
        &state,
        Some(&cookie),
        "https://api.bilibili.com/x/space/wbi/arc/search",
        &[
            ("mid".into(), mid.to_string()),
            ("pn".into(), page.to_string()),
            ("ps".into(), "30".into()),
            ("tid".into(), "0".into()),
            ("keyword".into(), String::new()),
            ("order".into(), "pubdate".into()),
            ("platform".into(), "web".into()),
            ("web_location".into(), "1550101".into()),
        ],
    )
    .await?;

    let videos = data["list"]["vlist"]
        .as_array()
        .map(|list| {
            list.iter()
                .map(|item| VideoSummary {
                    aid: item["aid"].as_i64().unwrap_or(0),
                    bvid: item["bvid"].as_str().unwrap_or_default().to_string(),
                    title: strip_em_tags(item["title"].as_str().unwrap_or("未命名稿件")),
                    cover: item["pic"]
                        .as_str()
                        .unwrap_or_default()
                        .replace("http://", "https://"),
                    created: item["created"].as_i64().unwrap_or(0),
                    duration: item["length"].as_str().unwrap_or_default().to_string(),
                    play: item["play"].as_i64().unwrap_or(0),
                    comment: item["review"].as_i64().unwrap_or(0),
                })
                .collect()
        })
        .unwrap_or_default();
    let total = data["page"]["count"].as_u64().unwrap_or(0) as u32;
    let page_count = total.div_ceil(30);
    Ok(VideosPage {
        videos,
        page,
        page_count,
        total,
    })
}

/// 解析单条评论（wbi/main 与 reply/main 的回复结构一致）
fn parse_comment(item: &serde_json::Value, is_top: bool) -> CommentItem {
    let member = &item["member"];
    let mut result = CommentItem {
        rpid: item["rpid"].as_i64().unwrap_or(0),
        mid: member["mid"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
        uname: member["uname"].as_str().unwrap_or("匿名用户").to_string(),
        avatar: member["avatar"]
            .as_str()
            .unwrap_or_default()
            .replace("http://", "https://"),
        level: member["level_info"]["current_level"]
            .as_i64()
            .unwrap_or(0) as i32,
        content: item["content"]["message"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
        likes: item["like"].as_i64().unwrap_or(0),
        ctime: item["ctime"].as_i64().unwrap_or(0),
        is_top,
        is_spam: false,
        is_marked: false,
        local_edit: None,
        replies: Vec::new(),
    };
    result.is_spam = spam::is_spam_comment(&result.content);
    result
}

/// 指定视频的评论区（aid + 分页；mode 对应 reply 接口语义：3=最热 2=时间）。
/// 两种排序的翻页方式不同：最热用页码（next），时间用游标（pagination_str，
/// 首页传空 offset，之后回传上一页响应里的 next_offset，见
/// bilibili-API-collect 对 reply/wbi/main 的说明）。
#[tauri::command]
pub async fn bilibili_comments_list(
    app: AppHandle,
    state: State<'_, AccountState>,
    aid: i64,
    page: u32,
    mode: u32,
    next_offset: Option<String>,
) -> Result<CommentsPage, String> {
    let (_, cookie) = state
        .bilibili_session(&app)?
        .ok_or_else(|| "请先在账号页登录 B 站账号".to_string())?;
    let mode = mode.clamp(2, 3);
    let mut params: Vec<(String, String)> = vec![
        ("oid".into(), aid.to_string()),
        ("type".into(), "1".into()),
        ("mode".into(), mode.to_string()),
        ("ps".into(), "20".into()),
        ("plat".into(), "1".into()),
        ("web_location".into(), "1315875".into()),
    ];
    if mode == 2 {
        let offset = next_offset.unwrap_or_default();
        params.push((
            "pagination_str".into(),
            format!("{{\"offset\":\"{offset}\"}}"),
        ));
    } else {
        params.push(("next".into(), page.max(1).to_string()));
    }

    // 优先走 wbi 签名端点；风控或签名异常时回退旧端点
    let data = match wbi_get(
        &state,
        Some(&cookie),
        "https://api.bilibili.com/x/v2/reply/wbi/main",
        &params,
    )
    .await
    {
        Ok(data) => data,
        Err(err) => {
            eprintln!("[bilibili_comments] wbi 端点失败，回退旧端点: {err}");
            wbi_get(
                &state,
                Some(&cookie),
                "https://api.bilibili.com/x/v2/reply/main",
                &params,
            )
            .await?
        }
    };

    let mut comments: Vec<CommentItem> = data["top_replies"]
        .as_array()
        .map(|list| list.iter().map(|item| parse_comment(item, true)).collect())
        .unwrap_or_default();
    comments.extend(
        data["replies"]
            .as_array()
            .map(|list| {
                list.iter()
                    .map(|item| parse_comment(item, false))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    );
    // 旧端点已加载过的置顶在翻页时可能重复出现
    comments.dedup_by_key(|c| c.rpid);

    // 注入用户的标记状态（按 rpid 匹配持久化的标记集合）
    let marked = marks::load_set(&app);
    // 注入本地修改与本地回复（仅本地存储与显示，不同步到 B 站）
    let notes = notes::load_notes(&app);
    for comment in &mut comments {
        comment.is_marked = marked.contains(&comment.rpid);
        comment.local_edit = notes::edit_for(&notes, comment.rpid);
        comment.replies = notes::replies_for(&notes, comment.rpid);
    }

    let total = data["cursor"]["all_count"].as_u64().unwrap_or(0) as u32;
    // is_end 为 JSON 布尔；个别端点可能回退为 0/1 数字，两种都兼容
    let is_end = data["cursor"]["is_end"].as_bool().unwrap_or(false)
        || data["cursor"]["is_end"].as_i64() == Some(1);
    let next_offset = data["cursor"]["pagination_reply"]["next_offset"]
        .as_str()
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    Ok(CommentsPage {
        comments,
        total,
        has_more: !is_end,
        next_offset,
    })
}
