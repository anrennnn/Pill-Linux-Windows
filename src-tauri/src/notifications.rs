//! Notificaciones del sistema (y de las webs abiertas, que llegan por el mismo canal).
//!
//! Linux: escuchamos las llamadas `Notify` en el bus de sesión (como `dbus-monitor`),
//! sin sustituir al gestor de notificaciones del escritorio. Es solo lectura.
//! Windows: pendiente; leerlas exige identidad de paquete (MSIX / Microsoft Store).

// En Windows solo se usan las piezas comunes: la escucha llegará con la versión MSIX.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
#[cfg(target_os = "linux")]
use tauri::Emitter;
use tauri::AppHandle;

pub static ENABLED: AtomicBool = AtomicBool::new(false);
static STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub struct Notification {
    /// Nombre de la app que la envía ("Google Chrome", "Thunderbird"…).
    pub app: String,
    /// Origen legible: la web si se detecta ("Slack"), si no la app.
    pub source: String,
    /// Dominio web si la notificación viene de un navegador.
    pub domain: Option<String>,
    pub title: String,
    pub body: String,
    pub desktop_entry: Option<String>,
    /// 0 baja · 1 normal · 2 crítica
    pub urgency: u8,
}

pub const SUPPORTED: bool = cfg!(target_os = "linux");

/// Quita el marcado básico que admite la especificación (<b>, <i>, <a>, <img>…).
pub fn strip_markup(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'")
}

const WEB_APPS: [(&str, &str); 14] = [
    ("slack.com", "Slack"),
    ("mail.google.com", "Gmail"),
    ("calendar.google.com", "Google Calendar"),
    ("chat.google.com", "Google Chat"),
    ("web.whatsapp.com", "WhatsApp"),
    ("web.telegram.org", "Telegram"),
    ("discord.com", "Discord"),
    ("teams.microsoft.com", "Teams"),
    ("teams.live.com", "Teams"),
    ("outlook.office.com", "Outlook"),
    ("outlook.live.com", "Outlook"),
    ("notion.so", "Notion"),
    ("linear.app", "Linear"),
    ("github.com", "GitHub"),
];

fn looks_like_domain(s: &str) -> Option<String> {
    let s = s.trim().trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("via ").trim_end_matches('/');
    let host = s.split('/').next().unwrap_or("");
    let valid = host.contains('.')
        && !host.contains(' ')
        && host.len() <= 80
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
        && host.rsplit('.').next().map(|tld| tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic())).unwrap_or(false);
    valid.then(|| host.to_lowercase())
}

pub fn web_name(domain: &str) -> String {
    WEB_APPS
        .iter()
        .find(|(d, _)| domain == *d || domain.ends_with(&format!(".{d}")))
        .map(|(_, n)| n.to_string())
        .unwrap_or_else(|| domain.trim_start_matches("www.").to_string())
}

const BROWSERS: [&str; 9] = ["google chrome", "chromium", "chrome", "firefox", "brave", "microsoft edge", "vivaldi", "opera", "librewolf"];

/// Construye la notificación a partir de los datos de `Notify`.
/// Los navegadores ponen el dominio de la web en la primera línea del cuerpo.
pub fn build(app: &str, summary: &str, body: &str, desktop_entry: Option<String>, urgency: u8) -> Notification {
    let body = strip_markup(body);
    let summary = strip_markup(summary);
    let is_browser = BROWSERS.iter().any(|b| app.to_lowercase().contains(b));
    let mut domain = None;
    let mut text = body.trim().to_string();
    if is_browser {
        let mut lines = body.lines();
        if let Some(first) = lines.next() {
            if let Some(d) = looks_like_domain(first) {
                domain = Some(d);
                text = lines.collect::<Vec<_>>().join("\n").trim().to_string();
            }
        }
    }
    let source = domain.as_deref().map(web_name).unwrap_or_else(|| if app.trim().is_empty() { "Sistema".into() } else { app.trim().to_string() });
    Notification {
        app: app.trim().to_string(),
        source,
        domain,
        title: summary.trim().chars().take(200).collect(),
        body: text.chars().take(600).collect(),
        desktop_entry,
        urgency,
    }
}

/// Las notificaciones de FocusPill no se vuelven a mostrar en la isla.
pub fn is_own(app: &str) -> bool {
    let a = app.to_lowercase();
    a == "focuspill" || a == "focus pill"
}

pub fn set_enabled(app: &AppHandle, enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
    if enabled && SUPPORTED && !STARTED.swap(true, Ordering::Relaxed) {
        spawn(app.clone());
    }
}

#[cfg(target_os = "linux")]
fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        if let Err(e) = listen(&app) {
            eprintln!("focuspill: no se pueden leer las notificaciones: {e}");
            STARTED.store(false, Ordering::Relaxed);
            let _ = app.emit("notifications-error", e);
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn spawn(_app: AppHandle) {}

/// Se convierte en monitor del bus de sesión y emite cada `Notify` que pase por él.
#[cfg(target_os = "linux")]
fn listen(app: &AppHandle) -> Result<(), String> {
    use std::collections::HashMap;
    use zbus::zvariant::{OwnedValue, Value};

    let conn = zbus::blocking::Connection::session().map_err(|e| e.to_string())?;
    let rules = vec!["type='method_call',interface='org.freedesktop.Notifications',member='Notify'"];
    conn.call_method(Some("org.freedesktop.DBus"), "/org/freedesktop/DBus", Some("org.freedesktop.DBus.Monitoring"), "BecomeMonitor", &(rules, 0u32))
        .map_err(|e| format!("el bus no permite escuchar ({e})"))?;

    for msg in zbus::blocking::MessageIterator::from(&conn) {
        let Ok(msg) = msg else { continue };
        if !ENABLED.load(Ordering::Relaxed) {
            continue;
        }
        let header = msg.header();
        if header.member().map(|m| m.as_str()) != Some("Notify") {
            continue;
        }
        type Args = (String, u32, String, String, String, Vec<String>, HashMap<String, OwnedValue>, i32);
        let Ok((app_name, _replaces, _icon, summary, body, _actions, hints, _timeout)) = msg.body().deserialize::<Args>() else { continue };
        if is_own(&app_name) {
            continue;
        }
        let hint_str = |k: &str| hints.get(k).and_then(|v| match &**v {
            Value::Str(s) => Some(s.to_string()),
            _ => None,
        });
        let urgency = hints.get("urgency").and_then(|v| match &**v {
            Value::U8(n) => Some(*n),
            _ => None,
        });
        let n = build(&app_name, &summary, &body, hint_str("desktop-entry"), urgency.unwrap_or(1));
        if n.title.is_empty() && n.body.is_empty() {
            continue;
        }
        let _ = app.emit("notification", &n);
    }
    Err("el bus de sesión cerró la conexión".into())
}

/// Para probar con un bus real: `cargo test notifications_live -- --ignored`
#[cfg(all(test, target_os = "linux"))]
pub fn listen_once(timeout: std::time::Duration) -> Result<Notification, String> {
    use std::collections::HashMap;
    use zbus::zvariant::OwnedValue;
    let conn = zbus::blocking::Connection::session().map_err(|e| e.to_string())?;
    let rules = vec!["type='method_call',interface='org.freedesktop.Notifications',member='Notify'"];
    conn.call_method(Some("org.freedesktop.DBus"), "/org/freedesktop/DBus", Some("org.freedesktop.DBus.Monitoring"), "BecomeMonitor", &(rules, 0u32))
        .map_err(|e| e.to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for msg in zbus::blocking::MessageIterator::from(&conn).flatten() {
            if msg.header().member().map(|m| m.as_str()) != Some("Notify") {
                continue;
            }
            type Args = (String, u32, String, String, String, Vec<String>, HashMap<String, OwnedValue>, i32);
            if let Ok((a, _, _, s, b, _, _, _)) = msg.body().deserialize::<Args>() {
                let _ = tx.send(build(&a, &s, &b, None, 1));
                return;
            }
        }
    });
    rx.recv_timeout(timeout).map_err(|_| "no llegó ninguna notificación".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_markup() {
        assert_eq!(strip_markup("<b>Ana</b>: hola &amp; <i>adiós</i>"), "Ana: hola & adiós");
        assert_eq!(strip_markup("<a href=\"https://x\">x.com</a>"), "x.com");
    }

    #[test]
    fn detects_web_apps_in_browser_notifications() {
        let n = build("Google Chrome", "Ana García", "<a href=\"https://app.slack.com/\">app.slack.com</a>\n\n¿Revisas el informe?", None, 1);
        assert_eq!(n.source, "Slack");
        assert_eq!(n.domain.as_deref(), Some("app.slack.com"));
        assert_eq!(n.body, "¿Revisas el informe?");
        let g = build("Chromium", "Nuevo correo", "mail.google.com\n\nFactura de octubre", None, 1);
        assert_eq!(g.source, "Gmail");
        let other = build("Firefox", "Aviso", "tienda.ejemplo.es\n\nTu pedido salió", None, 1);
        assert_eq!(other.source, "tienda.ejemplo.es");
    }

    #[test]
    fn keeps_native_apps_and_plain_text() {
        let n = build("Thunderbird", "Correo nuevo", "Hola. Esto no es un dominio", Some("thunderbird".into()), 2);
        assert_eq!(n.source, "Thunderbird");
        assert_eq!(n.domain, None);
        assert_eq!(n.body, "Hola. Esto no es un dominio");
        assert_eq!(n.urgency, 2);
        // Un navegador cuyo cuerpo no empieza por un dominio se queda con el nombre del navegador.
        assert_eq!(build("Firefox", "Descarga", "archivo.pdf terminado", None, 1).source, "Firefox");
        assert_eq!(build("", "x", "y", None, 1).source, "Sistema");
    }

    #[test]
    fn ignores_own_notifications() {
        assert!(is_own("focuspill"));
        assert!(is_own("FocusPill"));
        assert!(!is_own("Slack"));
    }

    #[test]
    fn domain_detection_is_strict() {
        assert_eq!(looks_like_domain("app.slack.com").as_deref(), Some("app.slack.com"));
        assert_eq!(looks_like_domain("https://web.whatsapp.com/").as_deref(), Some("web.whatsapp.com"));
        assert_eq!(looks_like_domain("archivo.pdf terminado"), None);
        assert_eq!(looks_like_domain("versión 1.2"), None);
        assert_eq!(web_name("www.notion.so"), "Notion");
    }

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore]
    fn notifications_live() {
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(700));
            let _ = std::process::Command::new("notify-send").args(["-a", "Google Chrome", "Ana", "app.slack.com\n\nHola desde Slack"]).status();
        });
        let n = listen_once(std::time::Duration::from_secs(5)).unwrap();
        assert_eq!(n.source, "Slack");
        assert_eq!(n.title, "Ana");
        assert_eq!(n.body, "Hola desde Slack");
    }
}
