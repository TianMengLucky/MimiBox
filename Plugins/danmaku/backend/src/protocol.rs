//! B 站直播弹幕协议封包/解包（见 bilibili-API-collect live/message_stream）。
//!
//! 包结构：16 字节头（包长 u32 / 头长 u16 / 协议版本 u16 / 操作码 u32 / 序号 u32，
//! 均大端）+ body。普通消息（op 5）在 protover 3 下为整段 brotli 压缩，
//! 解压后是一串 16 字节头子包的拼接。

use std::io::Read;

/// 包头长度（字节）
const HEADER_LEN: usize = 16;

const OP_MESSAGE: u32 = 5;
const PROTO_RAW_JSON: u16 = 0;
const PROTO_BROTLI: u16 = 3;

/// 构造一个完整协议包：16 字节头 + body
fn packet(op: u32, protover: u16, body: &[u8]) -> Vec<u8> {
    let len = (HEADER_LEN + body.len()) as u32;
    let mut out = Vec::with_capacity(len as usize);
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(&(HEADER_LEN as u16).to_be_bytes());
    out.extend_from_slice(&protover.to_be_bytes());
    out.extend_from_slice(&op.to_be_bytes());
    out.extend_from_slice(&1u32.to_be_bytes());
    out.extend_from_slice(body);
    out
}

/// 认证包（op 7）：连接建立后必须先发送
pub fn auth_packet(room_id: u64, uid: u64, token: &str, buvid: &str) -> Vec<u8> {
    let body = serde_json::json!({
        "uid": uid,
        "roomid": room_id,
        "protover": 3,
        "platform": "web",
        "type": 2,
        "key": token,
        "buvid": buvid,
    });
    packet(7, 1, body.to_string().as_bytes())
}

/// 心跳包（op 2）：每 30 秒发送一次，服务器回复人气值（op 3）
pub fn heartbeat_packet() -> Vec<u8> {
    packet(2, 1, b"")
}

/// 把一段原始字节流拆成 (protover, op, body) 列表；
/// 遇到长度异常的包即停止（防畸形数据死循环）
pub fn decode_packets(buf: &[u8]) -> Vec<(u16, u32, &[u8])> {
    let mut out = Vec::new();
    let mut offset = 0usize;
    while offset + HEADER_LEN <= buf.len() {
        let packet_len = u32::from_be_bytes(buf[offset..offset + 4].try_into().unwrap()) as usize;
        if packet_len < HEADER_LEN || packet_len > buf.len() - offset {
            break;
        }
        let protover = u16::from_be_bytes(buf[offset + 6..offset + 8].try_into().unwrap());
        let op = u32::from_be_bytes(buf[offset + 8..offset + 12].try_into().unwrap());
        out.push((protover, op, &buf[offset + HEADER_LEN..offset + packet_len]));
        offset += packet_len;
    }
    out
}

/// protover 3 的消息体是整段 brotli 压缩，解压为子包流
pub fn brotli_decompress(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    brotli::Decompressor::new(data, 4096)
        .read_to_end(&mut out)
        .map_err(|e| format!("弹幕数据解压失败: {e}"))?;
    Ok(out)
}

/// 处理一条服务器消息包：返回心跳人气值（op 3）或 None；
/// op 5 的 brotli 包在内部解压并逐条交给 `on_json`（子包为裸 JSON）。
pub fn ingest(
    protover: u16,
    op: u32,
    body: &[u8],
    on_json: &mut dyn FnMut(&[u8]),
) -> Result<Option<u64>, String> {
    match op {
        // 心跳回复：4 字节大端人气值
        3 => Ok(Some(if body.len() >= 4 {
            u32::from_be_bytes(body[..4].try_into().unwrap()) as u64
        } else {
            0
        })),
        OP_MESSAGE => {
            let payload = match protover {
                PROTO_BROTLI => brotli_decompress(body)?,
                PROTO_RAW_JSON => body.to_vec(),
                _ => return Ok(None),
            };
            for (sub_protover, sub_op, sub_body) in decode_packets(&payload) {
                if sub_op == OP_MESSAGE && sub_protover == PROTO_RAW_JSON {
                    on_json(sub_body);
                }
            }
            Ok(None)
        }
        _ => Ok(None),
    }
}
