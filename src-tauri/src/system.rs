//! Integración con el escritorio: "no molestar", atajos del sistema y entorno.

use std::process::Command;
#[cfg(target_os = "linux")]
use std::sync::Mutex;

use serde::Serialize;

#[derive(Serialize)]
pub struct EnvInfo {
    pub os: &'static str,
    pub session: String,
    pub desktop: String,
    pub dnd_supported: bool,
    pub tracking_supported: bool,
    pub system_shortcuts_supported: bool,
    pub notifications_supported: bool,
    pub edition: &'static str,
}

pub fn desktop() -> String {
    std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase()
}

#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub enum Desktop {
    Gnome,
    Cinnamon,
    Xfce,
    Kde,
    Mate,
    Other,
}

pub fn classify_desktop(raw: &str) -> Desktop {
    let d = raw.to_lowercase();
    if d.contains("cinnamon") || d.contains("x-cinnamon") {
        Desktop::Cinnamon
    } else if d.contains("kde") || d.contains("plasma") {
        Desktop::Kde
    } else if d.contains("xfce") {
        Desktop::Xfce
    } else if d.contains("mate") {
        Desktop::Mate
    } else if d.contains("gnome") || d.contains("unity") || d.contains("budgie") || d.contains("pop") || d.contains("cosmic") {
        Desktop::Gnome
    } else {
        Desktop::Other
    }
}

pub fn env_info(edition: &'static str) -> EnvInfo {
    let os = if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "macos" } else { "linux" };
    let session = if cfg!(target_os = "linux") {
        // Leemos la variable original: GDK_BACKEND=x11 no cambia el tipo de sesión.
        std::env::var("XDG_SESSION_TYPE").unwrap_or_else(|_| "x11".into())
    } else {
        os.to_string()
    };
    let d = classify_desktop(&desktop());
    EnvInfo {
        os,
        session: session.clone(),
        desktop: std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default(),
        dnd_supported: cfg!(target_os = "linux") && d != Desktop::Other,
        tracking_supported: cfg!(windows) || (cfg!(target_os = "linux") && std::env::var_os("DISPLAY").is_some()),
        system_shortcuts_supported: cfg!(target_os = "linux") && matches!(d, Desktop::Gnome | Desktop::Cinnamon | Desktop::Xfce),
        notifications_supported: crate::notifications::SUPPORTED,
        edition,
    }
}

fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(cmd).args(args).output().map_err(|e| format!("{cmd}: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/* ---------------- No molestar ---------------- */

#[cfg(target_os = "linux")]
pub struct Dnd {
    previous: Mutex<Option<String>>,
    kde_cookie: Mutex<Option<(zbus::blocking::Connection, u32)>>,
}

#[cfg(target_os = "linux")]
impl Dnd {
    pub fn new() -> Self {
        Dnd { previous: Mutex::new(None), kde_cookie: Mutex::new(None) }
    }

    /// Activa o desactiva "no molestar" y recuerda el valor anterior para restaurarlo.
    pub fn set(&self, on: bool) -> Result<(), String> {
        match classify_desktop(&desktop()) {
            Desktop::Gnome => self.gsettings_dnd("org.gnome.desktop.notifications", "show-banners", "false", on),
            Desktop::Cinnamon => self.gsettings_dnd("org.cinnamon.desktop.notifications", "display-notifications", "false", on),
            Desktop::Mate => self.gsettings_dnd("org.mate.NotificationDaemon", "do-not-disturb", "true", on),
            Desktop::Xfce => {
                let value = if on { "true" } else { "false" };
                run("xfconf-query", &["-c", "xfce4-notifyd", "-p", "/do-not-disturb", "-n", "-t", "bool", "-s", value])
                    .or_else(|_| run("xfconf-query", &["-c", "xfce4-notifyd", "-p", "/do-not-disturb", "-s", value]))
                    .map(|_| ())
            }
            Desktop::Kde => self.kde_inhibit(on),
            Desktop::Other => Err("Tu escritorio no permite activar «no molestar» desde aquí".into()),
        }
    }

    /// `dnd_value` es el valor de la clave que significa "no molestar activado".
    fn gsettings_dnd(&self, schema: &str, key: &str, dnd_value: &str, on: bool) -> Result<(), String> {
        let mut prev = self.previous.lock().unwrap();
        let target = if on {
            if prev.is_none() {
                *prev = run("gsettings", &["get", schema, key]).ok();
            }
            dnd_value.to_string()
        } else {
            let opposite = if dnd_value == "true" { "false" } else { "true" };
            match prev.take() {
                Some(v) if v == "true" || v == "false" => v,
                _ => opposite.to_string(),
            }
        };
        run("gsettings", &["set", schema, key, &target]).map(|_| ())
    }

    fn kde_inhibit(&self, on: bool) -> Result<(), String> {
        let mut guard = self.kde_cookie.lock().unwrap();
        if on {
            if guard.is_some() {
                return Ok(());
            }
            let conn = zbus::blocking::Connection::session().map_err(|e| e.to_string())?;
            let reply = conn
                .call_method(
                    Some("org.freedesktop.Notifications"),
                    "/org/freedesktop/Notifications",
                    Some("org.freedesktop.Notifications"),
                    "Inhibit",
                    &("focuspill", "Sesión de foco", std::collections::HashMap::<&str, zbus::zvariant::Value>::new()),
                )
                .map_err(|e| e.to_string())?;
            let cookie: u32 = reply.body().deserialize().map_err(|e| e.to_string())?;
            *guard = Some((conn, cookie));
            Ok(())
        } else if let Some((conn, cookie)) = guard.take() {
            conn.call_method(
                Some("org.freedesktop.Notifications"),
                "/org/freedesktop/Notifications",
                Some("org.freedesktop.Notifications"),
                "UnInhibit",
                &(cookie,),
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }
}

#[cfg(not(target_os = "linux"))]
pub struct Dnd;

#[cfg(not(target_os = "linux"))]
impl Dnd {
    pub fn new() -> Self {
        Dnd
    }
    pub fn set(&self, _on: bool) -> Result<(), String> {
        Err("«No molestar» automático aún no está disponible en este sistema".into())
    }
}

/* ---------------- Atajos del sistema (Wayland) ---------------- */

pub struct ShortcutSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub arg: &'static str,
    pub gnome: &'static str,
    pub xfce: &'static str,
}

pub const SHORTCUTS: [ShortcutSpec; 3] = [
    ShortcutSpec { id: "capture", name: "FocusPill: captura rápida", arg: "--capture", gnome: "<Primary><Alt>space", xfce: "<Primary><Alt>space" },
    ShortcutSpec { id: "focus", name: "FocusPill: iniciar o pausar foco", arg: "--toggle-focus", gnome: "<Primary><Alt>f", xfce: "<Primary><Alt>f" },
    ShortcutSpec { id: "panel", name: "FocusPill: abrir panel", arg: "--toggle-panel", gnome: "<Primary><Alt>p", xfce: "<Primary><Alt>p" },
];

fn exe() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.to_str().map(String::from))
        .filter(|p| !p.contains("/target/"))
        .unwrap_or_else(|| "focuspill".into())
}

/// Lista de rutas de un `gsettings get` del tipo `['/a/', '/b/']` o `@as []`.
pub fn parse_gsettings_list(raw: &str) -> Vec<String> {
    raw.split('\'')
        .enumerate()
        .filter(|(i, s)| i % 2 == 1 && !s.is_empty())
        .map(|(_, s)| s.to_string())
        .collect()
}

pub fn format_gsettings_list(items: &[String]) -> String {
    format!("[{}]", items.iter().map(|s| format!("'{s}'")).collect::<Vec<_>>().join(", "))
}

pub fn setup_system_shortcuts() -> Result<String, String> {
    let exe = exe();
    match classify_desktop(&desktop()) {
        Desktop::Gnome => {
            let base = "org.gnome.settings-daemon.plugins.media-keys";
            let mut list = parse_gsettings_list(&run("gsettings", &["get", base, "custom-keybindings"])?);
            for s in SHORTCUTS.iter() {
                let path = format!("/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/focuspill-{}/", s.id);
                let schema = format!("{base}.custom-keybinding:{path}");
                run("gsettings", &["set", &schema, "name", s.name])?;
                run("gsettings", &["set", &schema, "command", &format!("{exe} {}", s.arg)])?;
                run("gsettings", &["set", &schema, "binding", s.gnome])?;
                if !list.contains(&path) {
                    list.push(path);
                }
            }
            run("gsettings", &["set", base, "custom-keybindings", &format_gsettings_list(&list)])?;
            Ok("Atajos creados en GNOME".into())
        }
        Desktop::Cinnamon => {
            let base = "org.cinnamon.desktop.keybindings";
            let mut list = parse_gsettings_list(&run("gsettings", &["get", base, "custom-list"])?);
            for s in SHORTCUTS.iter() {
                let id = format!("focuspill-{}", s.id);
                let schema = format!("{base}.custom-keybinding:/org/cinnamon/desktop/keybindings/custom-keybindings/{id}/");
                run("gsettings", &["set", &schema, "name", s.name])?;
                run("gsettings", &["set", &schema, "command", &format!("{exe} {}", s.arg)])?;
                run("gsettings", &["set", &schema, "binding", &format!("['{}']", s.gnome)])?;
                if !list.contains(&id) {
                    list.push(id);
                }
            }
            run("gsettings", &["set", base, "custom-list", &format_gsettings_list(&list)])?;
            Ok("Atajos creados en Cinnamon".into())
        }
        Desktop::Xfce => {
            for s in SHORTCUTS.iter() {
                let prop = format!("/commands/custom/{}", s.xfce);
                run("xfconf-query", &["-c", "xfce4-keyboard-shortcuts", "-p", &prop, "-n", "-t", "string", "-s", &format!("{exe} {}", s.arg)])
                    .or_else(|_| run("xfconf-query", &["-c", "xfce4-keyboard-shortcuts", "-p", &prop, "-s", &format!("{exe} {}", s.arg)]))?;
            }
            Ok("Atajos creados en XFCE".into())
        }
        Desktop::Kde => Err("En KDE: Configuración del sistema → Atajos → Añadir comando, con «focuspill --capture», «--toggle-focus» y «--toggle-panel».".into()),
        _ => Err("Tu escritorio no permite crear atajos automáticamente. Añádelos a mano con los comandos «focuspill --capture», «--toggle-focus» y «--toggle-panel».".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_desktops() {
        assert_eq!(classify_desktop("ubuntu:GNOME"), Desktop::Gnome);
        assert_eq!(classify_desktop("X-Cinnamon"), Desktop::Cinnamon);
        assert_eq!(classify_desktop("KDE"), Desktop::Kde);
        assert_eq!(classify_desktop("XFCE"), Desktop::Xfce);
        assert_eq!(classify_desktop("Hyprland"), Desktop::Other);
    }

    #[test]
    fn round_trips_gsettings_lists() {
        assert!(parse_gsettings_list("@as []").is_empty());
        let l = parse_gsettings_list("['/a/', '/b/']");
        assert_eq!(l, vec!["/a/", "/b/"]);
        assert_eq!(format_gsettings_list(&l), "['/a/', '/b/']");
    }
}
