//! 每日放送时间表的抓取与解析（GET https://api.bgm.tv/calendar）。

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::{CalendarItem, WeekdayCalendar};

const CALENDAR_URL: &str = "https://api.bgm.tv/calendar";
const CACHE_TTL: Duration = Duration::from_secs(30 * 60);

/// Bangumi API 要求可识别的 User-Agent（见 bangumi/api 的 user-agent 规范）
const USER_AGENT: &str = concat!(
    "MimiBox/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/TianMengLucky/MimiBox)"
);

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
/// 缓存条目：抓取时间 + 上次结果
type CacheEntry = (Instant, Vec<WeekdayCalendar>);
static CACHE: OnceLock<Mutex<Option<CacheEntry>>> = OnceLock::new();

/// API 原始响应结构（仅解析需要的字段）
#[derive(Deserialize)]
struct RawCalendar {
    weekday: RawWeekday,
    #[serde(default)]
    items: Vec<RawItem>,
}

#[derive(Deserialize)]
struct RawWeekday {
    id: u8,
    #[serde(default)]
    cn: String,
}

#[derive(Deserialize)]
struct RawItem {
    id: u32,
    #[serde(default)]
    url: String,
    #[serde(default)]
    name: String,
    #[serde(default, rename = "nameCn")]
    name_cn: String,
    #[serde(default)]
    air_date: String,
    #[serde(default)]
    images: RawImages,
    #[serde(default)]
    rating: Option<RawRating>,
}

#[derive(Default, Deserialize)]
struct RawImages {
    #[serde(default)]
    common: Option<String>,
    #[serde(default)]
    large: Option<String>,
}

#[derive(Deserialize)]
struct RawRating {
    #[serde(default)]
    score: f32,
}

/// 带缓存的抓取入口；缓存命中直接返回，未命中则请求上游并写回
pub(super) async fn fetch() -> Result<Vec<WeekdayCalendar>, String> {
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    if let Some((at, data)) = cache
        .lock()
        .map_err(|_| "缓存锁定失败")?
        .clone()
    {
        if at.elapsed() < CACHE_TTL {
            return Ok(data);
        }
    }
    let data = fetch_remote().await?;
    *cache.lock().map_err(|_| "缓存锁定失败")? = Some((Instant::now(), data.clone()));
    Ok(data)
}

async fn fetch_remote() -> Result<Vec<WeekdayCalendar>, String> {
    let client = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(15))
            .build()
            .expect("构建 Bangumi HTTP 客户端失败")
    });
    let resp = client
        .get(CALENDAR_URL)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求 Bangumi 失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Bangumi 返回异常状态: {}", resp.status()));
    }
    let raw: Vec<RawCalendar> = resp
        .json()
        .await
        .map_err(|e| format!("解析 Bangumi 响应失败: {e}"))?;
    Ok(raw
        .into_iter()
        .map(|day| WeekdayCalendar {
            weekday: day.weekday.id,
            weekday_cn: day.weekday.cn,
            items: day
                .items
                .into_iter()
                .map(|item| CalendarItem {
                    image: item.images.common.or(item.images.large).unwrap_or_default(),
                    score: item.rating.map(|r| r.score).unwrap_or_default(),
                    id: item.id,
                    url: item.url,
                    name: item.name,
                    name_cn: item.name_cn,
                    air_date: item.air_date,
                })
                .collect(),
        })
        .collect())
}
