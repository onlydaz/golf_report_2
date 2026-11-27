//! Confirmed production SKU, persisted separately from the recipe editor's selection.
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, State};

const UNCONFIRMED: &str = "Chưa xác nhận với PLC";

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
    pub transition: tokio::sync::Mutex<()>,
    confirmation: Mutex<Option<tokio::sync::watch::Receiver<crate::plc::PlcStatus>>>,
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
            Ok(s) => {
                let error = s.as_ref().map(|_| UNCONFIRMED.to_string());
                (s, error)
            }
            Err(e) => (
                None,
                Some(format!("Không đọc được SKU sản xuất đã lưu: {e}")),
            ),
        };
        let started_at = chrono::Utc::now();
        Self {
            path,
            transition: tokio::sync::Mutex::new(()),
            confirmation: Mutex::new(None),
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
        let mut snapshot = self.state.lock().unwrap().clone();
        // Collection must fail closed immediately, even before the connection event
        // task has published the disconnect to the UI.
        if snapshot.selection.is_some() && snapshot.error.is_none() {
            let valid = self.confirmation.lock().unwrap().as_ref().is_some_and(|connection| {
                !connection.has_changed().unwrap_or(true)
                    && *connection.borrow() == crate::plc::PlcStatus::Connected
            });
            if !valid { snapshot.error = Some(UNCONFIRMED.into()); }
        }
        snapshot
    }

    fn set(&self, selection: Selection) -> Result<Snapshot, String> {
        selection.validate()?;
        let mut state = self.state.lock().unwrap();
        if state.selection.as_ref() == Some(&selection) && state.error.is_none() {
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
        let sku_changed =
            state.selection.as_ref().map(|s| s.sku.as_str()) != Some(selection.sku.as_str());
        state.selection = Some(selection);
        state.error = None;
        state.revision += 1;
        if sku_changed {
            state.session_started_at = chrono::Utc::now();
            // Revision also distinguishes a return to the same SKU within one app run.
            state.session_id = format!(
                "{}-{}",
                state.session_started_at.to_rfc3339(),
                state.revision
            );
        }
        Ok(state.clone())
    }

    /// Called only by the shared recipe command after PLC verification, while collection is paused.
    pub fn confirm(
        &self,
        app: &tauri::AppHandle,
        customer: String,
        sku: String,
        connection: &tokio::sync::watch::Receiver<crate::plc::PlcStatus>,
    ) -> Result<(), String> {
        *self.confirmation.lock().unwrap() = Some(connection.clone());
        let snapshot = self.set(Selection { customer, sku })?;
        let _ = app.emit("production://changed", &snapshot);
        Ok(())
    }

    pub fn uncertain(&self, app: &tauri::AppHandle) {
        let snapshot = {
            let mut state = self.state.lock().unwrap();
            if state.error.is_some() { return; }
            state.error = Some(UNCONFIRMED.into());
            state.revision += 1;
            state.clone()
        };
        let _ = app.emit("production://changed", snapshot);
    }
}

#[tauri::command]
pub async fn production_get(
    auth: State<'_, crate::auth::Auth>,
    db: State<'_, crate::db::DbPool>,
    state: State<'_, Production>,
) -> Result<Snapshot, String> {
    let _access = auth.require(&db, false).await?;
    Ok(state.get())
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
