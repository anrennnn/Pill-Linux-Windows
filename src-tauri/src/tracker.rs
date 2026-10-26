//! Registro de la aplicación en primer plano para el informe de foco real.
//! Solo guarda el nombre de la aplicación (nunca títulos de ventana) y deja de
//! contar cuando el usuario lleva un rato sin tocar el teclado ni el ratón.

use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const POLL: Duration = Duration::from_secs(5);
const IDLE_LIMIT_MS: u64 = 120_000;
const KEEP_DAYS: usize = 45;

/// día → aplicación → segundos
pub type Usage = BTreeMap<String, BTreeMap<String, u64>>;

pub struct Tracker {
    pub enabled: AtomicBool,
    pub usage: Mutex<Usage>,
    dirty: AtomicBool,
}

#[derive(Serialize, Clone)]
struct ActiveApp {
    app: Option<String>,
    idle: bool,
}

impl Tracker {
    pub fn new(usage: Usage) -> Self {
        Tracker { enabled: AtomicBool::new(true), usage: Mutex::new(usage), dirty: AtomicBool::new(false) }
    }

    fn add(&self, day: &str, app: &str, secs: u64) {
        let mut usage = self.usage.lock().unwrap();
        *usage.entry(day.to_string()).or_default().entry(app.to_string()).or_default() += secs;
        while usage.len() > KEEP_DAYS {
            let first = usage.keys().next().cloned().unwrap();
            usage.remove(&first);
        }
        self.dirty.store(true, Ordering::Relaxed);
    }

    pub fn take_dirty(&self) -> bool {
        self.dirty.swap(false, Ordering::Relaxed)
    }
}

/// Fecha local AAAA-MM-DD sin dependencias extra (la interfaz manda su zona al arrancar).
pub fn local_day(offset_minutes: i64) -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
        + offset_minutes * 60;
    let days = secs.div_euclid(86_400);
    civil_from_days(days)
}

/// Algoritmo de Howard Hinnant: días desde 1970-01-01 → fecha civil.
pub fn civil_from_days(z: i64) -> String {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}")
}

pub static UTC_OFFSET_MIN: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        let probe = match Probe::connect() {
            Some(p) => p,
            None => {
                eprintln!("focuspill: el registro de aplicaciones no está disponible en esta sesión");
                return;
            }
        };
        let mut last: Option<String> = None;
        loop {
            thread::sleep(POLL);
            let tracker = app.state::<Tracker>();
            if !tracker.enabled.load(Ordering::Relaxed) {
                continue;
            }
            let idle = probe.idle_ms() > IDLE_LIMIT_MS;
            let current = probe.active_app().filter(|a| a != "focuspill");
            if !idle {
                if let Some(name) = &current {
                    let day = local_day(UTC_OFFSET_MIN.load(Ordering::Relaxed));
                    tracker.add(&day, name, POLL.as_secs());
                }
            }
            if current != last || idle {
                let _ = app.emit("active-app", ActiveApp { app: current.clone(), idle });
            }
            last = current;
        }
    });
}

/* ---------------- Linux (X11 / XWayland) ---------------- */

#[cfg(target_os = "linux")]
struct Probe {
    conn: x11rb::rust_connection::RustConnection,
    root: u32,
    net_active: u32,
    has_screensaver: bool,
}

#[cfg(target_os = "linux")]
impl Probe {
    fn connect() -> Option<Self> {
        use x11rb::connection::{Connection, RequestConnection};
        use x11rb::protocol::xproto::ConnectionExt as _;
        let (conn, screen) = x11rb::connect(None).ok()?;
        let root = conn.setup().roots.get(screen)?.root;
        let net_active = conn.intern_atom(false, b"_NET_ACTIVE_WINDOW").ok()?.reply().ok()?.atom;
        let has_screensaver = conn
            .extension_information(x11rb::protocol::screensaver::X11_EXTENSION_NAME)
            .ok()
            .flatten()
            .is_some();
        Some(Probe { conn, root, net_active, has_screensaver })
    }

    fn active_app(&self) -> Option<String> {
        use x11rb::protocol::xproto::{AtomEnum, ConnectionExt as _};
        let reply = self
            .conn
            .get_property(false, self.root, self.net_active, AtomEnum::WINDOW, 0, 1)
            .ok()?
            .reply()
            .ok()?;
        let win = reply.value32()?.next()?;
        if win == 0 {
            return None;
        }
        let class = self
            .conn
            .get_property(false, win, AtomEnum::WM_CLASS, AtomEnum::STRING, 0, 256)
            .ok()?
            .reply()
            .ok()?;
        app_from_wm_class(&class.value)
    }

    fn idle_ms(&self) -> u64 {
        use x11rb::protocol::screensaver::ConnectionExt as _;
        if !self.has_screensaver {
            return 0;
        }
        self.conn
            .screensaver_query_info(self.root)
            .ok()
            .and_then(|c| c.reply().ok())
            .map(|r| r.ms_since_user_input as u64)
            .unwrap_or(0)
    }
}

/// WM_CLASS = "instancia\0Clase\0" → nombre de la clase en minúsculas.
#[cfg(any(target_os = "linux", test))]
pub fn app_from_wm_class(raw: &[u8]) -> Option<String> {
    let parts: Vec<&[u8]> = raw.split(|b| *b == 0).filter(|p| !p.is_empty()).collect();
    let pick = parts.get(1).or_else(|| parts.first())?;
    let name = String::from_utf8_lossy(pick).trim().to_lowercase();
    (!name.is_empty()).then_some(name)
}

/* ---------------- Windows ---------------- */

#[cfg(windows)]
struct Probe;

#[cfg(windows)]
impl Probe {
    fn connect() -> Option<Self> {
        Some(Probe)
    }

    fn active_app(&self) -> Option<String> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return None;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return None;
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len);
            CloseHandle(handle);
            if ok == 0 {
                return None;
            }
            let path = String::from_utf16_lossy(&buf[..len as usize]);
            let file = path.rsplit('\\').next()?.to_lowercase();
            Some(file.trim_end_matches(".exe").to_string())
        }
    }

    fn idle_ms(&self) -> u64 {
        use windows_sys::Win32::System::SystemInformation::GetTickCount;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        unsafe {
            let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
            if GetLastInputInfo(&mut info) == 0 {
                return 0;
            }
            GetTickCount().wrapping_sub(info.dwTime) as u64
        }
    }
}

/* ---------------- Otros sistemas ---------------- */

#[cfg(not(any(target_os = "linux", windows)))]
struct Probe;

#[cfg(not(any(target_os = "linux", windows)))]
impl Probe {
    fn connect() -> Option<Self> {
        None
    }
    fn active_app(&self) -> Option<String> {
        None
    }
    fn idle_ms(&self) -> u64 {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_wm_class() {
        assert_eq!(app_from_wm_class(b"Navigator\0firefox\0").as_deref(), Some("firefox"));
        assert_eq!(app_from_wm_class(b"code\0Code\0").as_deref(), Some("code"));
        assert_eq!(app_from_wm_class(b"solo\0").as_deref(), Some("solo"));
        assert_eq!(app_from_wm_class(b""), None);
    }

    #[test]
    fn converts_days_to_dates() {
        assert_eq!(civil_from_days(0), "1970-01-01");
        assert_eq!(civil_from_days(20_752), "2026-10-26");
        assert_eq!(civil_from_days(-1), "1969-12-31");
    }

    #[test]
    fn keeps_a_bounded_history() {
        let t = Tracker::new(Usage::new());
        for d in 0..(KEEP_DAYS + 5) {
            t.add(&format!("2026-01-{d:03}"), "code", 5);
        }
        assert_eq!(t.usage.lock().unwrap().len(), KEEP_DAYS);
        assert!(t.take_dirty());
        assert!(!t.take_dirty());
    }
}
