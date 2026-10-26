//! Apps instaladas y apertura de apps y webs para el lanzador de modos.

use std::{
    collections::BTreeMap,
    path::PathBuf,
    process::{Command, Stdio},
};
#[cfg(windows)]
use std::path::Path;

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct AppEntry {
    /// Linux: id del .desktop (p. ej. "firefox.desktop"); Windows: ruta del acceso directo.
    pub id: String,
    pub name: String,
}

/* ---------------- Linux: archivos .desktop ---------------- */

/// Lee lo imprescindible de un .desktop. Devuelve None si no debe mostrarse.
#[cfg(any(target_os = "linux", test))]
pub fn parse_desktop_entry(text: &str, lang: &str) -> Option<(String, String)> {
    let mut in_entry = false;
    let mut name = None;
    let mut localized = None;
    let mut exec = None;
    let mut kind = None;
    let lang_key = format!("Name[{lang}]");
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        match k.trim() {
            "Type" => kind = Some(v.trim().to_string()),
            "Name" => name = Some(v.trim().to_string()),
            "Exec" => exec = Some(v.trim().to_string()),
            "NoDisplay" | "Hidden" if v.trim() == "true" => return None,
            k if k == lang_key => localized = Some(v.trim().to_string()),
            _ => {}
        }
    }
    if kind.as_deref() != Some("Application") {
        return None;
    }
    Some((localized.or(name)?, exec?))
}

/// Quita los códigos de campo (%f, %U…) y separa la orden respetando comillas.
#[cfg(any(target_os = "linux", test))]
pub fn split_exec(exec: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut chars = exec.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => quoted = !quoted,
            '\\' if quoted => {
                if let Some(n) = chars.next() {
                    cur.push(n);
                }
            }
            ' ' if !quoted => {
                if !cur.is_empty() {
                    args.push(std::mem::take(&mut cur));
                }
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() {
        args.push(cur);
    }
    args.into_iter()
        .filter(|a| !(a.len() == 2 && a.starts_with('%')))
        .map(|a| a.replace("%%", "%"))
        .collect()
}

#[cfg(target_os = "linux")]
fn desktop_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let data_home = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")));
    if let Some(d) = data_home {
        dirs.push(d.join("applications"));
        dirs.push(d.join("flatpak/exports/share/applications"));
    }
    let data_dirs = std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    for d in data_dirs.split(':').filter(|d| !d.is_empty()) {
        dirs.push(PathBuf::from(d).join("applications"));
    }
    dirs.push(PathBuf::from("/var/lib/flatpak/exports/share/applications"));
    dirs.push(PathBuf::from("/var/lib/snapd/desktop/applications"));
    dirs
}

#[cfg(target_os = "linux")]
fn find_desktop(id: &str) -> Option<PathBuf> {
    desktop_dirs().into_iter().map(|d| d.join(id)).find(|p| p.is_file())
}

fn lang() -> String {
    std::env::var("LANG").unwrap_or_default().split(['_', '.']).next().unwrap_or("es").to_string()
}

pub fn list() -> Vec<AppEntry> {
    let mut found: BTreeMap<String, AppEntry> = BTreeMap::new();
    #[cfg(target_os = "linux")]
    {
        let lang = lang();
        // Los primeros directorios tienen prioridad (el usuario sobrescribe al sistema).
        for dir in desktop_dirs() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let id = e.file_name().to_string_lossy().to_string();
                if !id.ends_with(".desktop") || found.values().any(|a| a.id == id) {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
                if let Some((name, _)) = parse_desktop_entry(&text, &lang) {
                    found.insert(format!("{}|{id}", name.to_lowercase()), AppEntry { id, name });
                }
            }
        }
    }
    #[cfg(windows)]
    {
        let _ = lang();
        let roots = [
            std::env::var("ProgramData").ok().map(|p| PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs")),
            std::env::var("APPDATA").ok().map(|p| PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs")),
        ];
        for root in roots.into_iter().flatten() {
            collect_shortcuts(&root, 0, &mut found);
        }
    }
    found.into_values().collect()
}

#[cfg(windows)]
fn collect_shortcuts(dir: &Path, depth: u8, found: &mut BTreeMap<String, AppEntry>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let path = e.path();
        if path.is_dir() && depth < 3 {
            collect_shortcuts(&path, depth + 1, found);
        } else if path.extension().map(|x| x.eq_ignore_ascii_case("lnk")).unwrap_or(false) {
            let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let lower = name.to_lowercase();
            if lower.contains("uninstall") || lower.contains("desinstalar") {
                continue;
            }
            found.insert(format!("{lower}|{}", path.display()), AppEntry { id: path.display().to_string(), name });
        }
    }
}

fn spawn_detached(cmd: &mut Command) -> Result<(), String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Abre una app de la lista (o una orden escrita a mano).
pub fn launch(id: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if id.ends_with(".desktop") {
            let path = find_desktop(id).ok_or_else(|| format!("No se encontró {id}"))?;
            // gio y gtk-launch respetan Terminal=, DBusActivatable, etc.
            if Command::new("gio").arg("launch").arg(&path).stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false) {
                return Ok(());
            }
            if spawn_detached(Command::new("gtk-launch").arg(id)).is_ok() {
                return Ok(());
            }
            let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let (_, exec) = parse_desktop_entry(&text, &lang()).ok_or("Entrada .desktop no válida")?;
            return run_args(split_exec(&exec));
        }
        run_args(split_exec(id))
    }
    #[cfg(windows)]
    {
        spawn_detached(Command::new("cmd").args(["/C", "start", "", id]))
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        let _ = id;
        Err("No disponible".into())
    }
}

#[cfg(target_os = "linux")]
fn run_args(args: Vec<String>) -> Result<(), String> {
    let (bin, rest) = args.split_first().ok_or("Orden vacía")?;
    spawn_detached(Command::new(bin).args(rest))
}

/// Abre una web (http/https) en el navegador predeterminado.
pub fn open_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    // "javascript:", "mailto:", "file:"… se rechazan; "ejemplo.com" se completa con https://.
    let has_scheme = url.split_once(':').map(|(s, _)| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphabetic())).unwrap_or(false);
    let url = if has_scheme { url.to_string() } else { format!("https://{url}") };
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Solo se pueden abrir direcciones web".into());
    }
    #[cfg(target_os = "linux")]
    {
        spawn_detached(Command::new("xdg-open").arg(&url))
    }
    #[cfg(windows)]
    {
        spawn_detached(Command::new("cmd").args(["/C", "start", "", &url]))
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    {
        Err("No disponible".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_desktop_entries() {
        let text = "[Desktop Entry]\nType=Application\nName=Files\nName[es]=Archivos\nExec=nautilus --new-window %U\n\n[Desktop Action new]\nName=Otra\nExec=x";
        assert_eq!(parse_desktop_entry(text, "es"), Some(("Archivos".into(), "nautilus --new-window %U".into())));
        assert_eq!(parse_desktop_entry(text, "en").unwrap().0, "Files");
        assert_eq!(parse_desktop_entry("[Desktop Entry]\nType=Application\nName=X\nExec=x\nNoDisplay=true", "es"), None);
        assert_eq!(parse_desktop_entry("[Desktop Entry]\nType=Link\nName=X\nExec=x", "es"), None);
    }

    #[test]
    fn splits_exec_lines() {
        assert_eq!(split_exec("firefox %u"), vec!["firefox"]);
        assert_eq!(split_exec(r#"env "A B" app --flag=%%done %F"#), vec!["env", "A B", "app", "--flag=%done"]);
        assert_eq!(split_exec("  code   --new-window  "), vec!["code", "--new-window"]);
    }

    #[test]
    fn rejects_non_web_urls() {
        assert!(open_url("file:///etc/passwd").is_err());
        assert!(open_url("javascript:alert(1)").is_err());
        assert!(open_url("mailto:x@y.z").is_err());
    }

    /// Abre de verdad una app .desktop (necesita DISPLAY y xterm):
    /// `cargo test launches_desktop_entries -- --ignored`
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore]
    fn launches_desktop_entries() {
        let dir = std::env::temp_dir().join(format!("fp-apps-{}", std::process::id()));
        let apps = dir.join("applications");
        std::fs::create_dir_all(&apps).unwrap();
        std::fs::write(apps.join("modo-prueba.desktop"), "[Desktop Entry]\nType=Application\nName=Modo de prueba\nExec=xterm -class ModoPrueba %U\n").unwrap();
        std::env::set_var("XDG_DATA_HOME", &dir);
        assert!(list().iter().any(|a| a.id == "modo-prueba.desktop" && a.name == "Modo de prueba"));
        launch("modo-prueba.desktop").unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
