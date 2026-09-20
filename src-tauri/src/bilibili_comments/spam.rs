//! 灌水评论判定：无实质信息的水评（纯表情/符号、单字复读、常见口癖等）。
//! 数据量随评论数增长，放在 Rust 端计算，前端只按 is_spam 标记过滤。

/// 常见灌水口癖（与有效文本小写比较，仅短文本参与匹配）
const SPAM_WORDS: &[&str] = &[
    "前排", "后排", "沙发", "板凳", "地板", "地下室", "打卡", "签到", "来了", "来了来了", "看看",
    "看看看", "路过", "顶", "dd", "滴滴", "滴滴滴", "up", "666", "999", "888", "hhh", "hhhh",
    "hhhhh", "哈", "哈哈", "哈哈哈", "哈哈哈哈", "hhh啊", "嘿", "嘿嘿", "嘿嘿嘿", "嘻嘻", "呜",
    "呜呜", "呜呜呜", "啊", "啊这", "草", "艹", "蚌", "绷", "急", "麻", "麻了", "汗", "乐", "赢",
    "确实", "是的", "对", "对的", "好", "好的", "行", "ok", "嗯", "嗯嗯", "一", "二", "三", "十",
    "百", "万", "火钳", "火前留名", "刘明",
];

/// 去掉表情符号、空白和标点后剩下的"有效字符"（小写）
fn effective_text(content: &str) -> String {
    content
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// 判断一条评论是否属于灌水：有效内容为空、复读单字或命中口癖词
pub(crate) fn is_spam_comment(content: &str) -> bool {
    let text = effective_text(content);
    if text.is_empty() {
        return true;
    }
    if text.chars().count() <= 4 && SPAM_WORDS.contains(&text.as_str()) {
        return true;
    }
    // 单字复读（如"哈哈哈哈哈""66666"）
    let mut distinct = text.chars();
    let first = distinct.next().expect("已保证非空");
    distinct.all(|c| c == first)
}
