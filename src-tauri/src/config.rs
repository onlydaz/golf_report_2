//! Application settings read from `config.toml` (see `config.example.toml`).
//!
//! Lookup order: current working directory, then the directory of the executable.
//! Missing file or missing keys fall back to the defaults below.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = "config.toml";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub database: DbConfig,
    pub measurement: MeasurementConfig,
}

/// Machine settings shown on the monitor (load, push distance, bend limits, point positions).
/// The PLC does not send them; they only drive the chart limits and labels.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all(serialize = "camelCase"))]
pub struct MeasurementConfig {
    #[serde(default = "StationSettings::butt")]
    pub butt: StationSettings,
    #[serde(default = "StationSettings::tip")]
    pub tip: StationSettings,
}

impl Default for MeasurementConfig {
    fn default() -> Self {
        Self { butt: StationSettings::butt(), tip: StationSettings::tip() }
    }
}

/// A station table given in the file replaces the defaults as a whole: keys left
/// out are shown as "not configured".
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields, rename_all(serialize = "camelCase"))]
pub struct StationSettings {
    pub load_kg: Option<f32>,
    pub push_dist_mm: Option<f32>,
    pub bend_min_mm: Option<f32>,
    pub bend_max_mm: Option<f32>,
    pub positions_mm: Vec<f32>,
}

impl StationSettings {
    fn butt() -> Self {
        Self {
            load_kg: Some(2.5),
            push_dist_mm: Some(10.0),
            bend_min_mm: Some(50.0),
            bend_max_mm: Some(200.0),
            positions_mm: vec![150.0, 300.0, 450.0, 600.0],
        }
    }

    fn tip() -> Self {
        Self {
            load_kg: Some(2.5),
            push_dist_mm: Some(8.0),
            bend_min_mm: Some(50.0),
            bend_max_mm: Some(200.0),
            positions_mm: vec![80.0],
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DbConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    /// Written as-is, no URL encoding needed.
    pub password: String,
    /// Created at startup if missing.
    pub dbname: String,
    pub max_connections: u32,
}

impl Default for DbConfig {
    fn default() -> Self {
        Self {
            host: "localhost".into(),
            port: 5432,
            user: "postgres".into(),
            password: "postgres".into(),
            dbname: "golf_report".into(),
            max_connections: 5,
        }
    }
}

impl AppConfig {
    /// Load `config.toml`; on a missing or invalid file, log and use the defaults.
    pub fn load() -> Self {
        let Some(path) = find_file() else {
            eprintln!("config: {FILE_NAME} not found, using defaults");
            return Self::default();
        };
        match std::fs::read_to_string(&path)
            .map_err(|e| e.to_string())
            .and_then(|s| toml::from_str(&s).map_err(|e| e.to_string()))
        {
            Ok(cfg) => {
                eprintln!("config: loaded {}", path.display());
                cfg
            }
            Err(e) => {
                eprintln!("config: cannot read {}: {e}; using defaults", path.display());
                Self::default()
            }
        }
    }
}

fn find_file() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok().map(|d| d.join(FILE_NAME));
    let exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join(FILE_NAME)));
    [cwd, exe].into_iter().flatten().find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_file_keeps_defaults() {
        let cfg: AppConfig = toml::from_str("[database]\npassword = \"p@ss:/#?\"\n").unwrap();
        assert_eq!(cfg.database.password, "p@ss:/#?");
        assert_eq!(cfg.database.host, "localhost");
        assert_eq!(cfg.database.max_connections, 5);
        let empty: AppConfig = toml::from_str("").unwrap();
        assert_eq!(empty.database.dbname, DbConfig::default().dbname);
        // Old `url` key is rejected instead of silently ignored.
        assert!(toml::from_str::<AppConfig>("[database]\nurl = \"x\"\n").is_err());
    }

    #[test]
    fn measurement_defaults_and_override() {
        let cfg: AppConfig = toml::from_str("").unwrap();
        assert_eq!(cfg.measurement.butt.positions_mm.len(), 4);
        assert_eq!(cfg.measurement.tip.push_dist_mm, Some(8.0));
        let cfg: AppConfig =
            toml::from_str("[measurement.tip]\nbend_max_mm = 180.0\npositions_mm = [75.0]\n").unwrap();
        assert_eq!(cfg.measurement.tip.bend_max_mm, Some(180.0));
        assert_eq!(cfg.measurement.tip.bend_min_mm, None);
        assert_eq!(cfg.measurement.butt.bend_min_mm, Some(50.0));
    }
}
