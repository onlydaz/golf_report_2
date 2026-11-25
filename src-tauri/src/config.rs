//! Application settings read from `config.toml` (see `config.example.toml`).
//!
//! Lookup order: current working directory, then the directory of the executable.
//! Missing file or missing keys fall back to the defaults below.

use std::path::PathBuf;

use serde::Deserialize;

const FILE_NAME: &str = "config.toml";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub database: DbConfig,
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
}
