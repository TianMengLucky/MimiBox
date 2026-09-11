//! signer 绑定函数背后的原生算法实现（URL 解析、packed 解压、AES/RSA/ECDH）。
//!
//! 这些函数由 runtime.rs 的 b_* 宿主函数调用；错误以 String 返回，
//! 由调用方统一抛成 JS 异常。

use std::io::Read as _;

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use base64::Engine as _;
use flate2::read::DeflateDecoder;
use rand::RngCore as _;

pub(super) fn bytes_json(bytes: &[u8]) -> String {
    serde_json::to_string(bytes).unwrap_or_else(|_| "[]".into())
}

pub(super) fn bytes_from_json(raw: &str) -> Result<Vec<u8>, String> {
    let values: Vec<i64> = serde_json::from_str(raw).map_err(|e| format!("解析字节数组失败: {e}"))?;
    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            if !(0..=255).contains(value) {
                return Err(format!("invalid byte at index {index}"));
            }
            Ok(*value as u8)
        })
        .collect()
}

pub(super) fn parse_url(value: &str, base: &str) -> Result<String, String> {
    let parsed = if !base.is_empty() {
        let base_url = url::Url::parse(base).map_err(|e| format!("解析 base URL 失败: {e}"))?;
        base_url.join(value).map_err(|e| format!("解析 URL 失败: {e}"))?
    } else {
        url::Url::parse(value).map_err(|e| format!("解析 URL 失败: {e}"))?
    };
    Ok(marshal_url(&parsed))
}

pub(super) fn set_url_query(value: &str, query: &str) -> Result<String, String> {
    let mut parsed = url::Url::parse(value).map_err(|e| format!("解析 URL 失败: {e}"))?;
    parsed.set_query(Some(query));
    Ok(marshal_url(&parsed))
}

/// 输出字段与 Go net/url 的 marshalURL 对齐（垫片里的 URL 类按这些键读取）。
fn marshal_url(u: &url::Url) -> String {
    let host = u.host_str().unwrap_or("");
    let host_with_port = match u.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    };
    let origin = if !u.scheme().is_empty() && !host.is_empty() {
        format!("{}://{}", u.scheme(), host_with_port)
    } else {
        String::new()
    };
    serde_json::json!({
        "href": u.as_str(),
        "origin": origin,
        "protocol": format!("{}:", u.scheme()),
        "username": u.username(),
        "password": u.password().unwrap_or(""),
        "host": host_with_port,
        "hostname": host,
        "port": u.port().map(|p| p.to_string()).unwrap_or_default(),
        "pathname": u.path(),
        "search": u.query().unwrap_or(""),
        "hash": u.fragment().unwrap_or(""),
    })
    .to_string()
}

pub(super) fn decode_packed(value: &str) -> Result<Vec<u8>, String> {
    let raw = STANDARD
        .decode(value.trim())
        .map_err(|e| format!("base64 解码 packed 失败: {e}"))?;
    if raw.len() < 9 {
        return Err("packed payload is too short".into());
    }
    let key: usize = raw[4..8].iter().map(|b| *b as usize).sum::<usize>() % 256;
    let compressed: Vec<u8> = raw[8..]
        .iter()
        .enumerate()
        .map(|(index, byte)| byte ^ ((key + (key % 10) * index) % 256) as u8)
        .collect();
    let mut decoder = DeflateDecoder::new(&compressed[..]);
    let mut output = Vec::new();
    decoder
        .read_to_end(&mut output)
        .map_err(|e| format!("解压 packed 失败: {e}"))?;
    Ok(output)
}

pub(super) fn random_uuid() -> String {
    let mut value = [0u8; 16];
    rand::rng().fill_bytes(&mut value);
    value[6] = (value[6] & 0x0f) | 0x40;
    value[8] = (value[8] & 0x3f) | 0x80;
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        u32::from_be_bytes(value[0..4].try_into().unwrap()),
        u16::from_be_bytes(value[4..6].try_into().unwrap()),
        u16::from_be_bytes(value[6..8].try_into().unwrap()),
        u16::from_be_bytes(value[8..10].try_into().unwrap()),
        u64::from_be_bytes(value[10..16].try_into().unwrap()) & 0x000f_ffff_ffff_ffff,
    )
}

pub(super) fn aes_encrypt(key_hex: &str, plaintext: &str) -> Result<String, String> {
    use cbc::cipher::block_padding::Pkcs7;
    use cbc::cipher::generic_array::GenericArray;
    use cbc::cipher::{BlockEncryptMut, KeyIvInit};

    let key = hex::decode(key_hex.trim()).map_err(|e| format!("AES key hex 解码失败: {e}"))?;
    if key.len() != 16 {
        return Err(format!("仅支持 AES-128（16 字节 key），实际 {} 字节", key.len()));
    }
    let mut iv = [0u8; 16];
    rand::rng().fill_bytes(&mut iv);
    let encryptor: cbc::Encryptor<aes::Aes128> = cbc::Encryptor::new(
        GenericArray::from_slice(&key),
        GenericArray::from_slice(&iv),
    );
    let encrypted = encryptor.encrypt_padded_vec_mut::<Pkcs7>(plaintext.as_bytes());
    let mut cipher_text = Vec::with_capacity(16 + encrypted.len());
    cipher_text.extend_from_slice(&iv);
    cipher_text.extend_from_slice(&encrypted);
    Ok(serde_json::json!({
        "cipherText": STANDARD.encode(cipher_text),
        "encryptedData": STANDARD.encode(encrypted),
        "iv": STANDARD.encode(iv),
    })
    .to_string())
}

/// RSA/PKCS1v15 加密。入参支持：PEM 文本、base64 包裹的 PEM（dtrait-params 用）、
/// 裸 DER（PKCS#1 RSAPublicKey 或 PKIX SubjectPublicKeyInfo）。
pub(super) fn rsa_encrypt(public_key: &str, plaintext: &str) -> Result<String, String> {
    use rsa::pkcs1::DecodeRsaPublicKey;
    use rsa::pkcs8::DecodePublicKey;
    use rsa::Pkcs1v15Encrypt;

    let trimmed = public_key.trim();
    let pem_text;
    let der_bytes;
    let key = if trimmed.contains("BEGIN") {
        parse_pem_rsa(trimmed)?
    } else {
        let decoded = STANDARD
            .decode(trimmed.as_bytes())
            .or_else(|_| STANDARD_NO_PAD.decode(trimmed.as_bytes()))
            .map_err(|e| format!("RSA 公钥 base64 解码失败: {e}"))?;
        match String::from_utf8(decoded.clone()) {
            Ok(text) if text.contains("BEGIN") => {
                pem_text = text;
                parse_pem_rsa(&pem_text)?
            }
            _ => {
                der_bytes = decoded;
                rsa::RsaPublicKey::from_public_key_der(&der_bytes)
                    .or_else(|_| rsa::RsaPublicKey::from_pkcs1_der(&der_bytes))
                    .map_err(|e| format!("RSA 公钥 DER 解析失败: {e}"))?
            }
        }
    };

    let mut rng = rand_core::OsRng;
    let encrypted = key
        .encrypt(&mut rng, Pkcs1v15Encrypt, plaintext.as_bytes())
        .map_err(|e| format!("RSA 加密失败: {e}"))?;
    Ok(STANDARD.encode(encrypted))
}

fn parse_pem_rsa(pem: &str) -> Result<rsa::RsaPublicKey, String> {
    use rsa::pkcs1::DecodeRsaPublicKey;
    use rsa::pkcs8::DecodePublicKey;

    if pem.contains("BEGIN RSA PUBLIC KEY") {
        rsa::RsaPublicKey::from_pkcs1_pem(pem).map_err(|e| format!("PKCS#1 RSA 公钥解析失败: {e}"))
    } else if pem.contains("BEGIN PUBLIC KEY") {
        rsa::RsaPublicKey::from_public_key_pem(pem).map_err(|e| format!("PKIX 公钥解析失败: {e}"))
    } else if pem.contains("CERTIFICATE") {
        Err("暂不支持证书形式的 RSA 公钥".into())
    } else {
        Err("无法识别的 PEM 公钥类型".into())
    }
}

pub(super) fn ecdh_public_key() -> Result<String, String> {
    use p256::elliptic_curve::sec1::ToEncodedPoint;
    let secret = p256::SecretKey::random(&mut rand_core::OsRng);
    let point = secret.public_key().to_encoded_point(false);
    Ok(STANDARD.encode(point.as_bytes()))
}
