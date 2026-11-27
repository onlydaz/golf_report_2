use super::{
    Auth, Session, User, hash_password, normalize_username, repository, validate_name,
    validate_password, verify_password,
};
use crate::db::DbPool;
use tauri::State;

#[tauri::command]
pub async fn auth_login(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    username: String,
    password: String,
) -> Result<User, String> {
    let mut attempts = auth
        .attempts
        .try_lock()
        .map_err(|_| "Đang xác thực. Vui lòng chờ.")?;
    attempts.check()?;
    let mut session = auth
        .session
        .try_write()
        .map_err(|_| "Đang xử lý thao tác. Vui lòng chờ.")?;
    let pool = db.get()?;
    if let Some(saved) = session.as_ref() {
        if Auth::current(&pool, saved).await?.is_some() {
            return Err("Vui lòng đăng xuất trước khi đăng nhập tài khoản khác.".into());
        }
        *session = None;
    }
    auth.initialize(&pool).await?;
    let username = match normalize_username(&username) {
        Ok(username) => username,
        Err(_) => {
            attempts.failed();
            return Err(
                "Tên đăng nhập hoặc mật khẩu không đúng.".into(),
            );
        }
    };
    let row = repository::find_username(&pool, &username).await?;
    // Do the same Argon2 work for unknown usernames to avoid account enumeration.
    let fallback = if row.is_none() {
        repository::find_username(&pool, "admin").await?
    } else {
        None
    };
    let hash = row
        .as_ref()
        .or(fallback.as_ref())
        .ok_or("Chưa khởi tạo tài khoản quản trị.")?
        .password_hash
        .clone();
    let matches = verify_password(password, hash).await?;
    if let Some(row) = row.filter(|row| matches && row.user.is_active) {
        let candidate = Session {
            user_id: row.user.id,
            password_hash: row.password_hash,
        };
        // A lock/reset may have completed while Argon2 was running.
        let Some(current) = Auth::current(&pool, &candidate).await? else {
            attempts.failed();
            return Err(
                "Tên đăng nhập hoặc mật khẩu không đúng.".into(),
            );
        };
        *session = Some(candidate);
        *attempts = Default::default();
        Ok(current.user)
    } else {
        attempts.failed();
        Err("Tên đăng nhập hoặc mật khẩu không đúng.".into())
    }
}

#[tauri::command]
pub async fn auth_logout(auth: State<'_, Auth>) -> Result<(), String> {
    let mut session = auth
        .session
        .try_write()
        .map_err(|_| "Đang xử lý thao tác. Vui lòng chờ hoàn tất trước khi đăng xuất.")?;
    *session = None;
    Ok(())
}

#[tauri::command]
pub async fn auth_me(auth: State<'_, Auth>, db: State<'_, DbPool>) -> Result<Option<User>, String> {
    let mut session = auth.session.write().await;
    let Some(saved) = session.as_ref() else {
        return Ok(None);
    };
    match Auth::current(&db.get()?, saved).await? {
        Some(row) => Ok(Some(row.user)),
        None => {
            *session = None;
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn auth_change_password(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    current_password: String,
    new_password: String,
) -> Result<User, String> {
    let mut attempts = auth
        .attempts
        .try_lock()
        .map_err(|_| "Đang xác thực. Vui lòng chờ.")?;
    attempts.check()?;
    let mut session = auth
        .session
        .try_write()
        .map_err(|_| "Đang xử lý thao tác. Vui lòng chờ.")?;
    let saved = session.as_ref().ok_or("Vui lòng đăng nhập để tiếp tục.")?;
    let pool = db.get()?;
    let row = Auth::current(&pool, saved)
        .await?
        .ok_or("Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.")?;
    validate_password(&new_password)?;
    if !verify_password(current_password, row.password_hash.clone()).await? {
        attempts.failed();
        return Err("Mật khẩu hiện tại không đúng.".into());
    }
    if verify_password(new_password.clone(), row.password_hash.clone()).await? {
        return Err("Mật khẩu mới phải khác mật khẩu hiện tại.".into());
    }
    let hash = hash_password(new_password).await?;
    let user = repository::change_password(&pool, row.user.id, &row.password_hash, &hash).await?;
    *session = Some(Session {
        user_id: user.id,
        password_hash: hash,
    });
    *attempts = Default::default();
    Ok(user)
}

#[tauri::command]
pub async fn users_list(auth: State<'_, Auth>, db: State<'_, DbPool>) -> Result<Vec<User>, String> {
    let _access = auth.require(&db, true).await?;
    repository::list(&db.get()?).await
}

#[tauri::command]
pub async fn users_create(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    username: String,
    display_name: String,
    password: String,
) -> Result<(), String> {
    let _access = auth.require(&db, true).await?;
    let username = normalize_username(&username)?;
    if username == "admin" {
        return Err("Tên đăng nhập đã tồn tại.".into());
    }
    let name = validate_name(&display_name)?;
    validate_password(&password)?;
    let hash = hash_password(password).await?;
    repository::create(&db.get()?, &username, name, &hash).await
}

#[tauri::command]
pub async fn users_update(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    id: i64,
    display_name: String,
) -> Result<(), String> {
    let _access = auth.require(&db, true).await?;
    repository::update_name(&db.get()?, id, validate_name(&display_name)?).await
}

#[tauri::command]
pub async fn users_reset_password(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    id: i64,
    password: String,
) -> Result<(), String> {
    let _access = auth.require(&db, true).await?;
    validate_password(&password)?;
    let hash = hash_password(password).await?;
    repository::reset_password(&db.get()?, id, &hash).await
}

#[tauri::command]
pub async fn users_set_active(
    auth: State<'_, Auth>,
    db: State<'_, DbPool>,
    id: i64,
    is_active: bool,
) -> Result<(), String> {
    let _access = auth.require(&db, true).await?;
    repository::set_active(&db.get()?, id, is_active).await
}
