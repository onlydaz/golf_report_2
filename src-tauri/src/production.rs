//! Operator selection, persisted separately from PLC ActSKU and recipe parameters.
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, State};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Selection {
    pub customer: String,
    pub sku: String,
}

impl Selection {
    fn validate(&self) -> Result<(), String> {
        crate::recipe::model::validate_sku(&self.sku)?;
        if !matches!(self.customer.as_str(), "TM" | "MCC") {
            return Err("Khách hàng không hợp lệ.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub selection: Option<Selection>,
    pub error: Option<String>,
    pub revision: u64,
    pub session_id: String,
    pub session_started_at: chrono::DateTime<chrono::Utc>,
}

pub struct Production {
    path: PathBuf,
    state: Mutex<Snapshot>,
}

impl Production {
    pub fn load(path: PathBuf) -> Self {
        let result = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice::<Selection>(&bytes)
                .map_err(|e| e.to_string())
                .and_then(|s| {
                    s.validate()?;
                    Ok(Some(s))
                }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        };
        let (selection, error) = match result {
            Ok(s) => (s, None),
            Err(e) => (
                None,
                Some(format!("Không đọc được SKU sản xuất đã lưu: {e}")),
            ),
        };
        let started_at = chrono::Utc::now();
        Self {
            path,
            state: Mutex::new(Snapshot {
                selection,
                error,
                revision: 0,
                session_id: format!("{}-0", started_at.to_rfc3339()),
                session_started_at: started_at,
            }),
        }
    }

    pub fn get(&self) -> Snapshot {
        self.state.lock().unwrap().clone()
    }

    fn set(&self, selection: Selection) -> Result<Snapshot, String> {
        selection.validate()?;
        let mut state = self.state.lock().unwrap();
        if state.selection.as_ref() == Some(&selection) {
            return Ok(state.clone());
        }
        // Publish in memory only after the complete selection is persisted.
        let persist = || -> Result<(), Box<dyn std::error::Error>> {
            std::fs::create_dir_all(self.path.parent().ok_or("Thiếu thư mục cấu hình")?)?;
            let tmp = self.path.with_extension("tmp");
            let mut file = std::fs::File::create(&tmp)?;
            use std::io::Write;
            file.write_all(&serde_json::to_vec(&selection)?)?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(tmp, &self.path)?;
            Ok(())
        };
        persist().map_err(|e| format!("Không lưu được SKU sản xuất: {e}"))?;
        let sku_changed = state.selection.as_ref().map(|s| s.sku.as_str()) != Some(selection.sku.as_str());
        state.selection = Some(selection);
        state.error = None;
        state.revision += 1;
        if sku_changed {
            state.session_started_at = chrono::Utc::now();
            // Revision also distinguishes a return to the same SKU within one app run.
            state.session_id = format!("{}-{}", state.session_started_at.to_rfc3339(), state.revision);
        }
        Ok(state.clone())
    }
}

#[tauri::command]
pub fn production_get(state: State<'_, Production>) -> Snapshot {
    state.get()
}

#[tauri::command]
pub async fn production_select(
    app: tauri::AppHandle,
    state: State<'_, Production>,
    db: State<'_, crate::db::DbPool>,
    lifecycle: State<'_, crate::shutdown::Shutdown>,
    customer: String,
    sku: String,
) -> Result<Snapshot, String> {
    let _operation = lifecycle.operation()?;
    let selection = Selection { customer, sku };
    selection.validate()?;
    let valid: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM recipes WHERE customer = $1 AND sku = $2)")
            .bind(&selection.customer)
            .bind(&selection.sku)
            .fetch_one(&db.get()?)
            .await
            .map_err(|e| e.to_string())?;
    if !valid {
        return Err("SKU không thuộc khách hàng đã chọn.".into());
    }
    let snapshot = state.set(selection)?;
    let _ = app.emit("production://changed", &snapshot);
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_survives_restart_and_snapshots_do_not_change() {
        let dir = std::env::temp_dir().join(format!("golf-production-{}", std::process::id()));
        let path = dir.join("selection.json");
        let state = Production::load(path.clone());
        assert!(state.get().selection.is_none());
        let first = Selection {
            customer: "TM".into(),
            sku: "MH1253R".into(),
        };
        state.set(first.clone()).unwrap();
        let first_session = state.get();
        state.set(first.clone()).unwrap();
        assert_eq!(state.get().session_id, first_session.session_id);
        assert_eq!(state.get().session_started_at, first_session.session_started_at);
        assert!(state.set(Selection { customer: "UNKNOWN".into(), sku: "MH1253R".into() }).is_err());
        assert!(state.set(Selection { customer: "TM".into(), sku: "".into() }).is_err());
        let captured = state.get().selection.unwrap();
        let second = Selection {
            customer: "MCC".into(),
            sku: "MH1287S".into(),
        };
        state.set(second.clone()).unwrap();
        let second_session = state.get().session_id;
        assert_ne!(second_session, first_session.session_id);
        state.set(first.clone()).unwrap();
        assert_ne!(state.get().session_id, first_session.session_id);
        state.set(second.clone()).unwrap();
        assert_eq!(captured, first);
        assert_eq!(Production::load(path.clone()).get().selection, Some(second));
        std::fs::write(&path, b"broken").unwrap();
        assert!(Production::load(path.clone()).get().error.is_some());
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
