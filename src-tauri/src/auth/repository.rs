use super::User;
use sqlx::PgPool;

#[derive(sqlx::FromRow)]
pub(super) struct UserRecord {
    #[sqlx(flatten)]
    pub user: User,
    pub password_hash: String,
}

fn db_error(error: sqlx::Error) -> String {
    if error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation())
    {
        "Tên đăng nhập đã tồn tại.".into()
    } else {
        // Never expose SQL parameters or password hashes through errors/logs.
        "Không thể truy cập dữ liệu tài khoản. Vui lòng kiểm tra kết nối cơ sở dữ liệu.".into()
    }
}

pub(super) async fn seed_admin(pool: &PgPool) -> Result<(), String> {
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE role = 'ADMIN')")
            .fetch_one(pool)
            .await
            .map_err(db_error)?;
    if !exists {
        let hash = super::hash_password("newocean@123".into()).await?;
        sqlx::query(
            "INSERT INTO users (username, display_name, password_hash, role)
                     VALUES ('admin', 'Quản trị viên', $1, 'ADMIN') ON CONFLICT DO NOTHING",
        )
        .bind(hash)
        .execute(pool)
        .await
        .map_err(db_error)?;
    }
    Ok(())
}

pub(super) async fn find_username(
    pool: &PgPool,
    username: &str,
) -> Result<Option<UserRecord>, String> {
    sqlx::query_as("SELECT * FROM users WHERE lower(username) = lower($1)")
        .bind(username)
        .fetch_optional(pool)
        .await
        .map_err(db_error)
}

pub(super) async fn find_id(pool: &PgPool, id: i64) -> Result<Option<UserRecord>, String> {
    sqlx::query_as("SELECT * FROM users WHERE id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(db_error)
}

pub(super) async fn list(pool: &PgPool) -> Result<Vec<User>, String> {
    sqlx::query_as("SELECT id, username, display_name, role, is_active, created_at, updated_at
                    FROM users ORDER BY id")
        .fetch_all(pool).await.map_err(db_error)
}

pub(super) async fn create(
    pool: &PgPool,
    username: &str,
    name: &str,
    hash: &str,
) -> Result<(), String> {
    sqlx::query("INSERT INTO users (username, display_name, password_hash, role) VALUES ($1, $2, $3, 'OPERATOR')")
        .bind(username).bind(name).bind(hash).execute(pool).await.map_err(db_error)?;
    Ok(())
}

fn updated(rows: u64) -> Result<(), String> {
    if rows == 1 {
        Ok(())
    } else {
        Err("Không tìm thấy tài khoản người vận hành hoặc tài khoản đã thay đổi.".into())
    }
}

pub(super) async fn update_name(pool: &PgPool, id: i64, name: &str) -> Result<(), String> {
    updated(
        sqlx::query("UPDATE users SET display_name = $2 WHERE id = $1 AND role = 'OPERATOR'")
            .bind(id)
            .bind(name)
            .execute(pool)
            .await
            .map_err(db_error)?
            .rows_affected(),
    )
}

pub(super) async fn reset_password(pool: &PgPool, id: i64, hash: &str) -> Result<(), String> {
    updated(sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1 AND role = 'OPERATOR'")
        .bind(id).bind(hash).execute(pool).await.map_err(db_error)?.rows_affected())
}

pub(super) async fn set_active(pool: &PgPool, id: i64, active: bool) -> Result<(), String> {
    updated(
        sqlx::query("UPDATE users SET is_active = $2 WHERE id = $1 AND role = 'OPERATOR'")
            .bind(id)
            .bind(active)
            .execute(pool)
            .await
            .map_err(db_error)?
            .rows_affected(),
    )
}

pub(super) async fn change_password(
    pool: &PgPool,
    id: i64,
    previous: &str,
    hash: &str,
) -> Result<User, String> {
    sqlx::query_as("UPDATE users SET password_hash = $3
                    WHERE id = $1 AND password_hash = $2 AND is_active
                    RETURNING id, username, display_name, role, is_active, created_at, updated_at")
        .bind(id).bind(previous).bind(hash).fetch_optional(pool).await.map_err(db_error)?
        .ok_or_else(|| "Tài khoản đã thay đổi. Vui lòng đăng nhập lại.".into())
}
