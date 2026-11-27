pub mod commands;
mod repository;

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use chrono::{DateTime, Utc};
use rand_core::OsRng;
use serde::Serialize;
use sqlx::PgPool;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, OnceCell, RwLock, RwLockReadGuard};

#[derive(Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub role: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

struct Session {
    user_id: i64,
    // Detect password resets in other running instances without a session table.
    password_hash: String,
}

#[derive(Default)]
struct Attempts {
    failures: u8,
    blocked_until: Option<Instant>,
}

impl Attempts {
    fn check(&mut self) -> Result<(), String> {
        if let Some(until) = self.blocked_until {
            if until > Instant::now() {
                return Err("Đã nhập sai quá nhiều lần. Vui lòng thử lại sau 60 giây.".into());
            }
            *self = Self::default();
        }
        Ok(())
    }

    fn failed(&mut self) {
        self.failures += 1;
        if self.failures >= 5 {
            self.blocked_until = Some(Instant::now() + Duration::from_secs(60));
        }
    }
}

#[derive(Default)]
pub struct Auth {
    session: RwLock<Option<Session>>,
    attempts: Mutex<Attempts>,
    initialized: OnceCell<()>,
}

// Retained through the entire command: logout cannot interrupt an authorized transfer.
pub struct Access<'a> {
    _session: RwLockReadGuard<'a, Option<Session>>,
}

impl Auth {
    pub async fn initialize(&self, pool: &PgPool) -> Result<(), String> {
        self.initialized
            .get_or_try_init(|| repository::seed_admin(pool))
            .await?;
        Ok(())
    }

    async fn current(
        pool: &PgPool,
        session: &Session,
    ) -> Result<Option<repository::UserRecord>, String> {
        Ok(repository::find_id(pool, session.user_id)
            .await?
            .filter(|row| row.user.is_active && row.password_hash == session.password_hash))
    }

    pub async fn require<'a>(
        &'a self,
        db: &crate::db::DbPool,
        admin: bool,
    ) -> Result<Access<'a>, String> {
        let session = self.session.read().await;
        let saved = session.as_ref().ok_or("Vui lòng đăng nhập để tiếp tục.")?;
        let row = Self::current(&db.get()?, saved)
            .await?
            .ok_or("Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.")?;
        if admin && row.user.role != "ADMIN" {
            return Err("Chỉ Quản trị viên được sử dụng chức năng này.".into());
        }
        Ok(Access { _session: session })
    }
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.len() > 1024 {
        return Err("Mật khẩu quá dài. Vui lòng chọn mật khẩu ngắn hơn.".into());
    }
    if password.chars().count() < 6 {
        return Err("Mật khẩu phải có ít nhất 6 ký tự.".into());
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err("Tên nhân viên phải có từ 1 đến 100 ký tự.".into());
    }
    Ok(name)
}

fn normalize_username(username: &str) -> Result<String, String> {
    let username = username.trim().to_ascii_lowercase();
    if !(3..=64).contains(&username.len())
        || !username
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
    {
        return Err("Tên đăng nhập phải có 3–64 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.".into());
    }
    Ok(username)
}

async fn hash_password(password: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|_| "Không thể bảo vệ mật khẩu.".to_string())
    })
    .await
    .map_err(|_| "Không thể xử lý mật khẩu.".to_string())?
}

async fn verify_password(password: String, hash: String) -> Result<bool, String> {
    if password.len() > 1024 {
        return Ok(false);
    }
    tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).ok().is_some_and(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
    })
    .await
    .map_err(|_| "Không thể xác thực mật khẩu.".to_string())
}
