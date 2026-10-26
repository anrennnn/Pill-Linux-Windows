//! Persistencia: estado de la interfaz, copias de seguridad diarias y exportación.

use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager};

const KEEP_BACKUPS: usize = 14;

pub fn data_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

pub fn data_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    Some(data_dir(app)?.join(name))
}

/// Escritura atómica y privada: el estado guarda tokens de integraciones.
pub fn write_private(path: &Path, data: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(tmp, path)
}

pub fn read_state(app: &AppHandle) -> Option<String> {
    fs::read_to_string(data_file(app, "state.json")?).ok()
}

pub fn write_state(app: &AppHandle, data: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(data).map_err(|_| "Estado no válido".to_string())?;
    let path = data_file(app, "state.json").ok_or("sin carpeta de datos")?;
    write_private(&path, data).map_err(|e| e.to_string())?;
    daily_backup(app, &path, data);
    Ok(())
}

fn backups_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = data_dir(app)?.join("backups");
    fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// Una copia por día: la primera escritura del día guarda el estado.
fn daily_backup(app: &AppHandle, _state_path: &Path, data: &str) {
    let Some(dir) = backups_dir(app) else { return };
    let day = crate::tracker::local_day(crate::tracker::UTC_OFFSET_MIN.load(std::sync::atomic::Ordering::Relaxed));
    let target = dir.join(format!("state-{day}.json"));
    if target.exists() {
        return;
    }
    let _ = write_private(&target, data);
    prune(&dir);
}

fn prune(dir: &Path) {
    let mut files = list_backup_files(dir);
    while files.len() > KEEP_BACKUPS {
        let oldest = files.remove(0);
        let _ = fs::remove_file(dir.join(oldest));
    }
}

fn list_backup_files(dir: &Path) -> Vec<String> {
    let mut files: Vec<String> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().into_string().ok())
                .filter(|n| n.starts_with("state-") && n.ends_with(".json"))
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

pub fn list_backups(app: &AppHandle) -> Vec<String> {
    backups_dir(app)
        .map(|d| list_backup_files(&d).into_iter().rev().map(|f| f.trim_start_matches("state-").trim_end_matches(".json").to_string()).collect())
        .unwrap_or_default()
}

pub fn read_backup(app: &AppHandle, day: &str) -> Result<String, String> {
    if !day.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return Err("Fecha no válida".into());
    }
    let dir = backups_dir(app).ok_or("sin copias")?;
    fs::read_to_string(dir.join(format!("state-{day}.json"))).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prunes_oldest_backups() {
        let dir = std::env::temp_dir().join(format!("focuspill-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        for d in 1..=20 {
            fs::write(dir.join(format!("state-2026-01-{d:02}.json")), "{}").unwrap();
        }
        prune(&dir);
        let left = list_backup_files(&dir);
        assert_eq!(left.len(), KEEP_BACKUPS);
        assert_eq!(left[0], "state-2026-01-07.json");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn writes_private_files() {
        use std::os::unix::fs::PermissionsExt;
        let path = std::env::temp_dir().join(format!("focuspill-priv-{}.json", std::process::id()));
        write_private(&path, "{}").unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        fs::remove_file(path).unwrap();
    }
}
