//! One serialized recipe handshake through the existing PlcHandle.
//! No retries of writes, no background worker, no connection owned here.
use super::{
    encode::{self, RECIPE_BASE},
    model::Recipe,
};
use crate::plc::{PlcError, PlcHandle, PlcStatus};
use serde::{Deserialize, Serialize};
use std::{future::Future, time::Duration};
use tokio::{
    sync::{Mutex, watch},
    time::{Instant, sleep, timeout, timeout_at},
};

const HANDSHAKE_BASE: u16 = 20000 + crate::plc::registers::MODBUS_OFFSET;
const HANDSHAKE_WORDS: u16 = 20;
const ACK_TIMEOUT: Duration = Duration::from_secs(3); // Workbook: Bat tay D20000, step 4.
const POLL_DELAY: Duration = Duration::from_millis(100);
// Modbus Application Protocol V1.1b3 §6.12, NOT an AS200 device limit:
// https://www.modbus.org/docs/Modbus_Application_Protocol_V1_1b3.pdf
const FC16_PROTOCOL_MAX: u16 = 123;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TransferConfig {
    pub commissioned: bool,
    pub max_write_words: Option<u16>,
    /// Technician's acceptance record covering travel/load limits, write limit and safe Ladder handshake.
    pub confirmation_reference: String,
}

impl TransferConfig {
    fn check_commissioning(&self) -> Result<(), String> {
        if !self.commissioned || self.confirmation_reference.trim().is_empty() {
            return Err("Nạp PLC đang khóa: chưa có xác nhận kỹ thuật về hành trình, tải tối đa, giới hạn ghi Modbus và Ladder handshake an toàn.".into());
        }
        Ok(())
    }

    fn chunk_words(&self) -> Result<usize, String> {
        match self.max_write_words {
            Some(n) if (1..=FC16_PROTOCOL_MAX).contains(&n) => Ok(n as usize),
            _ => Err("Chưa có giới hạn ghi FC16 được xác nhận cho máy (max_write_words phải từ 1 đến 123).".into()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Handshake {
    pub pc_cmd: u16,
    pub plc_ack: u16,
    pub plc_idle: u16,
    pub act_sku: String,
    pub act_rev: i32,
}

impl Handshake {
    fn decode(words: &[u16]) -> Result<Self, String> {
        if words.len() != HANDSHAKE_WORDS as usize {
            return Err("PLC trả sai kích thước vùng handshake.".into());
        }
        // Same low-byte-first ASCII as ProductCode; do not trim whitespace when verifying identity.
        let bytes: Vec<u8> = words[4..14].iter().flat_map(|w| w.to_le_bytes()).collect();
        let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
        if !bytes[..end].is_ascii() || bytes[end..].iter().any(|b| *b != 0) {
            return Err("ActSKU không đúng chuỗi ASCII đệm 0 theo mapping.".into());
        }
        Ok(Self {
            pc_cmd: words[0],
            plc_ack: words[1],
            plc_idle: words[2],
            act_sku: String::from_utf8(bytes[..end].to_vec()).unwrap(),
            act_rev: (u32::from(words[14]) | (u32::from(words[15]) << 16)) as i32,
        })
    }
    fn ready(&self) -> bool {
        self.pc_cmd == 0 && self.plc_ack == 0 && self.plc_idle == 1
    }
    fn matches(&self, expected: &Expected) -> bool {
        self.act_sku == expected.sku && self.act_rev == expected.rev
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Success,
    Failed,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferError {
    pub kind: Outcome,
    pub message: String,
}
impl TransferError {
    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            kind: Outcome::Failed,
            message: message.into(),
        }
    }
    fn unknown(message: impl Into<String>) -> Self {
        Self {
            kind: Outcome::Unknown,
            message: format!(
                "Chưa xác định kết quả nạp. {} Không tự động nạp lại; hãy đối chiếu trạng thái PLC.",
                message.into()
            ),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferReport {
    pub outcome: Outcome,
    pub message: String,
    pub handshake: Handshake,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferStatus {
    pub handshake: Option<Handshake>,
    pub busy: bool,
    pub needs_reconcile: bool,
    pub commissioned: bool,
    pub max_write_words: Option<u16>,
    pub confirmation_reference: String,
    pub blocked_reason: Option<String>,
    pub read_error: Option<String>,
}

#[derive(Clone)]
struct Expected {
    sku: String,
    rev: i32,
}

pub struct RecipeTransfer {
    config: TransferConfig,
    // Held throughout load/transfer/reconciliation. Some = last attempt requires explicit review.
    pending: Mutex<Option<Expected>>,
}

impl RecipeTransfer {
    pub fn new(config: TransferConfig) -> Self {
        Self {
            config,
            pending: Mutex::new(None),
        }
    }

    pub async fn apply(
        &self,
        plc: &PlcHandle,
        expected_rev: i32,
        load: impl Future<Output = Result<Recipe, String>>,
    ) -> Result<TransferReport, TransferError> {
        let mut pending = self
            .pending
            .try_lock()
            .map_err(|_| TransferError::failed("Đang có thao tác công thức PLC. Vui lòng chờ."))?;
        self.config
            .check_commissioning()
            .map_err(TransferError::failed)?;
        let chunk_words = self.config.chunk_words().map_err(TransferError::failed)?;
        if pending.is_some() {
            return Err(TransferError::unknown("Lần nạp trước chưa được đối chiếu."));
        }
        let mut link = Link::new(plc).map_err(TransferError::failed)?;
        let recipe = timeout(Duration::from_secs(10), load)
            .await
            .map_err(|_| {
                TransferError::failed("Hết thời gian đọc công thức từ cơ sở dữ liệu; chưa ghi PLC.")
            })?
            .map_err(TransferError::failed)?;
        if recipe.summary.recipe_rev != expected_rev {
            return Err(TransferError::failed(
                "Phiên bản trong database đã thay đổi. Hãy tải lại công thức trước khi nạp.",
            ));
        }
        let words = encode::encode(&recipe).map_err(TransferError::failed)?;
        encode::check_result_capacity(&recipe).map_err(TransferError::failed)?;
        let initial = link
            .read(Instant::now() + ACK_TIMEOUT)
            .await
            .map_err(TransferError::failed)?;
        if !initial.ready() {
            return Err(TransferError::failed(
                "Chưa được phép nạp: cần PLC_Idle=1, PLC_Ack=0 và PC_Cmd=0. Chưa ghi công thức.",
            ));
        }
        let expected = Expected {
            sku: recipe.summary.sku,
            rev: expected_rev,
        };
        *pending = Some(expected.clone());
        for (index, chunk) in words.chunks(chunk_words).enumerate() {
            let addr = RECIPE_BASE + (index * chunk_words) as u16;
            if let Err(e) = link.write_chunk(addr, chunk.to_vec()).await {
                if matches!(e, PlcError::Exception { .. }) {
                    *pending = None; // No PC_Cmd=1 sent; PLC must not apply the staging area.
                    return Err(TransferError::failed(format!(
                        "Ghi khối D{addr} thất bại: {e}. Chưa gửi yêu cầu áp dụng; không tự ghi lại."
                    )));
                }
                return Err(TransferError::unknown(format!(
                    "Lỗi truyền khối D{addr}: {e}. Chưa gửi PC_Cmd=1."
                )));
            }
        }
        let before_command = link
            .read(Instant::now() + ACK_TIMEOUT)
            .await
            .map_err(TransferError::unknown)?;
        if !before_command.ready() {
            if before_command.pc_cmd == 0 && before_command.plc_ack == 0 {
                *pending = None;
                return Err(TransferError::failed(
                    "PLC không còn cho phép đổi công thức. Chưa gửi PC_Cmd=1.",
                ));
            }
            return Err(TransferError::unknown(
                "Handshake đã thay đổi trong lúc ghi dữ liệu. Chưa gửi PC_Cmd=1.",
            ));
        }
        // Set pending BEFORE sending; a lost FC06 response does not prove the write failed.
        link.write_cmd(1)
            .await
            .map_err(|e| TransferError::unknown(format!("Không xác nhận được PC_Cmd=1: {e}.")))?;
        let ack = wait_terminal(&mut link)
            .await
            .map_err(TransferError::unknown)?;
        let report = finish(&mut link, ack, Some(&expected)).await?;
        if report.outcome != Outcome::Unknown {
            *pending = None;
        }
        Ok(report)
    }

    /// Read-only status. Does not acknowledge or retry anything, including after reconnect.
    pub async fn status(&self, plc: &PlcHandle) -> TransferStatus {
        let commissioning = self.config.check_commissioning();
        let commissioned = commissioning.is_ok();
        let policy = commissioning.and_then(|_| self.config.chunk_words());
        let mut result = TransferStatus {
            handshake: None,
            busy: false,
            needs_reconcile: false,
            commissioned,
            max_write_words: self.config.max_write_words,
            confirmation_reference: self.config.confirmation_reference.clone(),
            blocked_reason: policy.err(),
            read_error: None,
        };
        let Ok(pending) = self.pending.try_lock() else {
            result.busy = true;
            return result;
        };
        result.needs_reconcile = pending.is_some();
        drop(pending); // Status I/O must not hold the lock used by apply/reconcile.
        let read = async {
            let mut link = Link::new(plc)?;
            link.read(Instant::now() + ACK_TIMEOUT).await
        }
        .await;
        // A writer may have started while we were reading. Do not expose its partial handshake.
        let Ok(pending) = self.pending.try_lock() else {
            result.busy = true;
            return result;
        };
        result.needs_reconcile = pending.is_some();
        match read {
            Ok(h) => {
                result.needs_reconcile |= h.pc_cmd != 0 || h.plc_ack != 0;
                result.handshake = Some(h);
            }
            Err(e) => result.read_error = Some(e),
        }
        result
    }

    /// Explicit operator action after an uncertain attempt or an interrupted app session.
    /// Only completes a terminal handshake; never sends recipe data or PC_Cmd=1.
    pub async fn reconcile(&self, plc: &PlcHandle) -> Result<TransferReport, TransferError> {
        let mut pending = self
            .pending
            .try_lock()
            .map_err(|_| TransferError::failed("Đang có thao tác công thức PLC. Vui lòng chờ."))?;
        self.config
            .check_commissioning()
            .map_err(TransferError::failed)?;
        let mut link = Link::new(plc).map_err(TransferError::unknown)?;
        let h = link
            .read(Instant::now() + ACK_TIMEOUT)
            .await
            .map_err(TransferError::unknown)?;
        let report = if h.pc_cmd == 1 && (h.plc_ack == 1 || h.plc_ack >= 10) {
            finish(&mut link, h, pending.as_ref()).await?
        } else if h.pc_cmd == 0 {
            let final_state = if h.plc_ack == 0 {
                h
            } else {
                wait_zero(&mut link).await.map_err(TransferError::unknown)?
            };
            TransferReport { outcome: Outcome::Unknown,
                message: "Đã đọc lại PLC: PC_Cmd=0 và PLC_Ack=0. Không đủ bằng chứng xác nhận lần nạp trước; kiểm tra mã hàng/phiên bản đang áp dụng trước khi nạp tiếp.".into(),
                handshake: final_state }
        } else {
            return Err(TransferError::unknown(
                "PLC chưa trả ACK kết thúc hợp lệ. Giữ nguyên PC_Cmd; cần kỹ thuật viên kiểm tra Ladder, không tự reset.",
            ));
        };
        // Explicit review + observed completed handshake permits a NEW operator-confirmed request.
        *pending = None;
        Ok(report)
    }
}

/// A watch receiver detects even a disconnect+reconnect between two operations.
/// Never continue the same transfer on a replacement connection.
struct Link<'a> {
    plc: &'a PlcHandle,
    status: watch::Receiver<PlcStatus>,
}
impl<'a> Link<'a> {
    fn new(plc: &'a PlcHandle) -> Result<Self, String> {
        let mut status = plc.subscribe_status();
        if *status.borrow_and_update() != PlcStatus::Connected {
            return Err("PLC chưa kết nối.".into());
        }
        Ok(Self { plc, status })
    }
    fn check(&self) -> Result<(), PlcError> {
        if self.status.has_changed().unwrap_or(true)
            || *self.status.borrow() != PlcStatus::Connected
        {
            return Err(PlcError::Disconnected(
                "Kết nối đã thay đổi trong thao tác công thức".into(),
            ));
        }
        Ok(())
    }
    async fn read(&mut self, deadline: Instant) -> Result<Handshake, String> {
        self.check().map_err(|e| e.to_string())?;
        let words = timeout_at(
            deadline,
            self.plc
                .read_holding_registers(HANDSHAKE_BASE, HANDSHAKE_WORDS),
        )
        .await
        .map_err(|_| "Hết thời gian chờ phản hồi handshake (3 giây).".to_string())?
        .map_err(|e| format!("Không đọc được handshake: {e}"))?;
        self.check().map_err(|e| e.to_string())?;
        Handshake::decode(&words)
    }
    async fn write_chunk(&self, addr: u16, words: Vec<u16>) -> Result<(), PlcError> {
        self.check()?;
        let result = self.plc.write_multiple_registers(addr, words).await;
        self.check()?;
        result
    }
    async fn write_cmd(&self, value: u16) -> Result<(), PlcError> {
        self.check()?;
        // Do not wrap writes in a canceling timeout: a queued request could execute later.
        // The existing Actor bounds each Modbus operation with its request_timeout.
        let result = self.plc.write_single_register(HANDSHAKE_BASE, value).await;
        self.check()?;
        result
    }
}

async fn wait_terminal(link: &mut Link<'_>) -> Result<Handshake, String> {
    let deadline = Instant::now() + ACK_TIMEOUT;
    loop {
        let h = link.read(deadline).await?;
        if h.pc_cmd != 1 {
            return Err("PC_Cmd thay đổi ngoài trình tự đang nạp.".into());
        }
        if h.plc_ack == 1 || h.plc_ack >= 10 {
            return Ok(h);
        }
        if h.plc_ack != 0 {
            return Err(format!(
                "PLC_Ack={} không được định nghĩa trong Excel.",
                h.plc_ack
            ));
        }
        if Instant::now() >= deadline {
            return Err("PLC chưa trả ACK kết thúc sau 3 giây.".into());
        }
        sleep(POLL_DELAY.min(deadline.saturating_duration_since(Instant::now()))).await;
    }
}

async fn wait_zero(link: &mut Link<'_>) -> Result<Handshake, String> {
    let deadline = Instant::now() + ACK_TIMEOUT;
    loop {
        let h = link.read(deadline).await?;
        if h.pc_cmd != 0 {
            return Err("PC_Cmd chưa về 0 hoặc đã bị thay đổi ngoài thao tác này.".into());
        }
        if h.plc_ack == 0 {
            return Ok(h);
        }
        if Instant::now() >= deadline {
            return Err("PLC_Ack chưa về 0 sau 3 giây; handshake chưa hoàn tất.".into());
        }
        sleep(POLL_DELAY.min(deadline.saturating_duration_since(Instant::now()))).await;
    }
}

async fn finish(
    link: &mut Link<'_>,
    ack: Handshake,
    expected: Option<&Expected>,
) -> Result<TransferReport, TransferError> {
    // Workbook order: observe terminal ACK and compare ActSKU/ActRev BEFORE resetting PC_Cmd.
    let matched = expected.is_some_and(|e| ack.matches(e));
    let rejection = (ack.plc_ack >= 10).then(|| ack_message(ack.plc_ack));
    let evidence = rejection
        .clone()
        .unwrap_or_else(|| format!("Đã đọc ACK={}", ack.plc_ack));
    link.write_cmd(0).await.map_err(|e| {
        TransferError::unknown(format!("{evidence}; không xác nhận được PC_Cmd=0: {e}"))
    })?;
    let h = wait_zero(link)
        .await
        .map_err(|e| TransferError::unknown(format!("{evidence}; {e}")))?;
    let (outcome, message) = if let Some(message) = rejection {
        (Outcome::Failed, message)
    } else if matched && expected.is_some_and(|e| h.matches(e)) {
        (
            Outcome::Success,
            format!(
                "Đã nạp {} · phiên bản {}. PLC xác nhận đúng và handshake đã hoàn tất.",
                h.act_sku, h.act_rev
            ),
        )
    } else {
        (
            Outcome::Unknown,
            format!(
                "Handshake đã hoàn tất nhưng chưa xác nhận đúng công thức yêu cầu. PLC đang áp dụng {} · phiên bản {}. Cần đối chiếu trước khi nạp tiếp.",
                h.act_sku, h.act_rev
            ),
        )
    };
    Ok(TransferReport {
        outcome,
        message,
        handshake: h,
    })
}

fn ack_message(code: u16) -> String {
    let detail = match code {
        10 => "Máy đang chạy (PLC_Idle=0).".into(),
        11 => "Version hoặc RecordSize sai.".into(),
        12 => "SKU rỗng.".into(),
        21..=28 | 31..=38 => {
            let station = if code < 30 { "BUTT" } else { "TIP" };
            let detail = match code % 10 {
                1 => "Số điểm ngoài 1–10.",
                2 => "Số lần xoay ngoài 0–3.",
                3 => "Vị trí tịnh tiến ngoài hành trình.",
                4 => "Lực đè không dương, vượt tải loadcell hoặc dung sai lực đè âm.",
                5 => "Vị trí đo lực ngoài hành trình.",
                6 => "Độ cong không dương hoặc dung sai độ cong âm.",
                7 => "Vị trí đè cố định ngoài hành trình.",
                _ => "Thời gian ổn định âm.",
            };
            format!("Trạm {station}: {detail}")
        }
        _ => "Mã lỗi chưa được mô tả trong Excel; cần kỹ thuật viên kiểm tra.".into(),
    };
    format!("PLC từ chối nạp (ACK={code}): {detail}")
}

#[cfg(test)]
#[path = "transfer_tests.rs"]
mod tests;
