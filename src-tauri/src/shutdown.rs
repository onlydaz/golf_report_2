//! Exit gate shared by recipe commands, collection and the existing DB writer.
use std::sync::{Arc, Mutex, atomic::AtomicBool};
use tauri::{Manager, State};
use tokio::sync::{mpsc, oneshot, watch};

#[derive(Default)]
struct Work {
    closing: bool,
    operations: usize,
    saves: usize,
    failed: usize,
}

#[derive(Clone)]
pub struct Shutdown {
    work: Arc<Mutex<Work>>,
    pub pause: watch::Sender<bool>,
    pub paused: watch::Sender<bool>,
    pub approved: Arc<AtomicBool>,
    exit: mpsc::Sender<oneshot::Sender<Result<(), String>>>,
}

pub struct Operation(Shutdown);
impl Drop for Operation {
    fn drop(&mut self) {
        self.0.work.lock().unwrap().operations -= 1;
    }
}

impl Shutdown {
    pub fn new() -> (Self, mpsc::Receiver<oneshot::Sender<Result<(), String>>>) {
        let (exit, rx) = mpsc::channel(1);
        let (pause, _) = watch::channel(false);
        let (paused, _) = watch::channel(false);
        (
            Self {
                work: Arc::default(),
                pause,
                paused,
                approved: Arc::new(AtomicBool::new(false)),
                exit,
            },
            rx,
        )
    }
    pub fn operation(&self) -> Result<Operation, String> {
        let mut work = self.work.lock().unwrap();
        if work.closing {
            return Err("Ứng dụng đang chuẩn bị thoát. Vui lòng chờ.".into());
        }
        work.operations += 1;
        Ok(Operation(self.clone()))
    }
    pub fn begin_save(&self) {
        self.work.lock().unwrap().saves += 1;
    }
    pub fn finish_save(&self, success: bool) {
        let mut work = self.work.lock().unwrap();
        work.saves -= 1;
        if !success {
            work.failed += 1;
        }
    }
    fn begin_exit(&self) -> Result<(), String> {
        let mut work = self.work.lock().unwrap();
        if work.closing || work.operations > 0 {
            return Err(
                "Đang chọn SKU hoặc lưu/nạp/đối chiếu công thức. Vui lòng chờ hoàn tất.".into(),
            );
        }
        if work.failed > 0 {
            return Err(format!(
                "Có {} bản ghi lưu lỗi chưa được xử lý an toàn. Chưa thể thoát; cần kiểm tra dữ liệu và kết nối PostgreSQL.",
                work.failed
            ));
        }
        work.closing = true;
        Ok(())
    }
    pub fn cancel(&self) {
        self.pause.send_replace(false);
        self.work.lock().unwrap().closing = false;
    }
    pub fn can_stop(&self) -> bool {
        let work = self.work.lock().unwrap();
        work.closing && work.saves == 0 && work.failed == 0 && *self.paused.borrow()
    }
}

#[tauri::command]
pub async fn app_shutdown(app: tauri::AppHandle, state: State<'_, Shutdown>) -> Result<(), String> {
    state.begin_exit()?;
    // No new recipe operation can start after begin_exit; pending is checked without PLC I/O.
    if let Err(e) = app
        .state::<crate::recipe::transfer::RecipeTransfer>()
        .ensure_shutdown_safe()
    {
        state.cancel();
        return Err(e);
    }
    let (tx, rx) = oneshot::channel();
    if state.exit.send(tx).await.is_err() {
        state.cancel();
        return Err("Không liên lạc được với tác vụ thu thập để thoát an toàn.".into());
    }
    let result = rx
        .await
        .unwrap_or_else(|_| Err("Chưa xác nhận được thu thập đã dừng an toàn.".into()));
    if result.is_err() {
        state.cancel();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exit_waits_for_saves_and_blocks_new_operations() {
        let (state, _) = Shutdown::new();
        let operation = state.operation().unwrap();
        assert!(state.begin_exit().is_err());
        drop(operation);
        state.begin_save();
        state.begin_exit().unwrap();
        assert!(state.operation().is_err());
        assert!(!state.can_stop());
        state.finish_save(true);
        state.paused.send_replace(false);
        assert!(!state.can_stop());
        state.paused.send_replace(true);
        assert!(state.can_stop());
        state.cancel();
        assert!(state.operation().is_ok());
    }
    #[test]
    fn failed_save_never_allows_silent_exit() {
        let (state, _) = Shutdown::new();
        state.begin_save();
        state.finish_save(false);
        assert!(state.begin_exit().is_err());
    }
}
