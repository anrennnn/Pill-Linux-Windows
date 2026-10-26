//! Forma y posición de la ventana: modos, monitores y región que acepta clics.

use std::{
    sync::{atomic::AtomicBool, Mutex},
    time::Instant,
};

use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

/// Tamaños lógicos de la ventana para cada modo. La isla visible se dibuja
/// centrada arriba dentro de la ventana; el resto es margen transparente.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Pill,
    Capture,
    Media,
    Panel,
}

impl Mode {
    pub fn parse(s: &str) -> Mode {
        match s {
            "capture" => Mode::Capture,
            "media" => Mode::Media,
            "panel" => Mode::Panel,
            _ => Mode::Pill,
        }
    }

    pub fn size(self) -> (f64, f64) {
        match self {
            Mode::Pill => (320.0, 60.0),
            Mode::Capture => (520.0, 72.0),
            Mode::Media => (480.0, 124.0),
            Mode::Panel => (460.0, 640.0),
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub monitor: Option<String>,
}

pub struct WinState {
    pub mode: Mutex<Mode>,
    /// Esquina superior izquierda de la ventana en modo píldora (px físicos).
    pub anchor: Mutex<Option<(i32, i32)>>,
    pub anchor_dirty: AtomicBool,
    /// Los movimientos que provocamos nosotros no deben cambiar el ancla.
    pub last_place: Mutex<Instant>,
    /// Monitor elegido en Ajustes (None = el principal).
    pub monitor: Mutex<Option<String>>,
}

impl WinState {
    pub fn new() -> Self {
        WinState {
            mode: Mutex::new(Mode::Pill),
            anchor: Mutex::new(None),
            anchor_dirty: AtomicBool::new(false),
            last_place: Mutex::new(Instant::now()),
            monitor: Mutex::new(None),
        }
    }
}

#[derive(Serialize)]
pub struct MonitorInfo {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub primary: bool,
}

/// Las sesiones Wayland no permiten a una app fijar su posición ni mantenerse
/// encima de las demás, así que usamos XWayland salvo que el usuario lo desactive.
pub fn prepare_linux_env() {
    #[cfg(target_os = "linux")]
    {
        let wayland = std::env::var("XDG_SESSION_TYPE").map(|v| v == "wayland").unwrap_or(false)
            || std::env::var_os("WAYLAND_DISPLAY").is_some();
        if wayland && std::env::var_os("FOCUSPILL_NATIVE_WAYLAND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        // Evita ventanas en blanco con algunos drivers (NVIDIA, VMs).
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

pub fn monitors(window: &WebviewWindow) -> Vec<MonitorInfo> {
    let primary = window.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let name = m.name().cloned().unwrap_or_else(|| format!("Monitor {}", i + 1));
            MonitorInfo {
                primary: Some(&name) == primary.as_ref(),
                name,
                x: m.position().x,
                y: m.position().y,
                width: m.size().width,
                height: m.size().height,
                scale: m.scale_factor(),
            }
        })
        .collect()
}

/// Arriba al centro del monitor elegido (o del principal).
pub fn default_anchor(window: &WebviewWindow, monitor: Option<&str>) -> (i32, i32) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let pill_w = (Mode::Pill.size().0 * scale) as i32;
    let list = monitors(window);
    let target = monitor
        .and_then(|name| list.iter().find(|m| m.name == name))
        .or_else(|| list.iter().find(|m| m.primary))
        .or_else(|| list.first());
    match target {
        Some(m) => (m.x + (m.width as i32 - pill_w) / 2, m.y + (10.0 * m.scale) as i32),
        None => (200, 10),
    }
}

/// Monitor que contiene el punto, o el principal si no hay ninguno.
fn monitor_bounds(window: &WebviewWindow, x: i32, y: i32) -> Option<(i32, i32, i32, i32)> {
    let list = monitors(window);
    let m = list
        .iter()
        .find(|m| x >= m.x && x < m.x + m.width as i32 && y >= m.y && y < m.y + m.height as i32)
        .or_else(|| list.iter().find(|m| m.primary))
        .or_else(|| list.first())?;
    Some((m.x, m.y, m.width as i32, m.height as i32))
}

pub fn anchor_on_screen(window: &WebviewWindow, (x, y): (i32, i32)) -> bool {
    monitors(window).iter().any(|m| {
        x >= m.x - 50 && x < m.x + m.width as i32 && y >= m.y - 50 && y < m.y + m.height as i32
    })
}

/// Calcula la posición de la ventana para un modo sin salirse del monitor.
pub fn layout(anchor: (i32, i32), pill_w: i32, size: (i32, i32), bounds: Option<(i32, i32, i32, i32)>) -> (i32, i32) {
    let (pw, ph) = size;
    let center_x = anchor.0 + pill_w / 2;
    let mut x = center_x - pw / 2;
    let mut y = anchor.1;
    if let Some((mx, my, mw, mh)) = bounds {
        x = x.clamp(mx, (mx + mw - pw).max(mx));
        if y + ph > my + mh {
            y = (my + mh - ph).max(my);
        }
        y = y.max(my);
    }
    (x, y)
}

pub fn place(window: &WebviewWindow, state: &WinState, mode: Mode) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let (w, h) = mode.size();
    let (pw, ph) = ((w * scale) as i32, (h * scale) as i32);
    let pill_w = (Mode::Pill.size().0 * scale) as i32;

    let anchor = {
        let mut a = state.anchor.lock().unwrap();
        if a.is_none() {
            let monitor = state.monitor.lock().unwrap().clone();
            *a = Some(default_anchor(window, monitor.as_deref()));
        }
        a.unwrap()
    };
    let bounds = monitor_bounds(window, anchor.0 + pill_w / 2, anchor.1);
    let (x, y) = layout(anchor, pill_w, (pw, ph), bounds);

    *state.mode.lock().unwrap() = mode;
    *state.last_place.lock().unwrap() = Instant::now();
    let _ = window.set_size(PhysicalSize::new(pw as u32, ph as u32));
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// Limita la zona que recibe clics a la isla visible (en px lógicos).
/// `None` devuelve los clics a toda la ventana, p. ej. durante una animación.
pub fn set_input_region(window: &WebviewWindow, rect: Option<(f64, f64, f64, f64, f64)>) {
    #[cfg(target_os = "linux")]
    {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || {
            use gtk::prelude::WidgetExt;
            let Ok(gtk_window) = w.gtk_window() else { return };
            let Some(gdk_window) = gtk_window.window() else { return };
            let (x, y, width, height) = match rect {
                Some((x, y, width, height, _)) => (x.floor() as i32, y.floor() as i32, width.ceil() as i32, height.ceil() as i32),
                None => (0, 0, 10_000, 10_000),
            };
            let region = gtk::cairo::Region::create_rectangle(&gtk::cairo::RectangleInt::new(x, y, width, height));
            gdk_window.input_shape_combine_region(&region, 0, 0);
        });
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
        let scale = window.scale_factor().unwrap_or(1.0);
        if let Ok(hwnd) = window.hwnd() {
            let hwnd = hwnd.0 as windows_sys::Win32::Foundation::HWND;
            unsafe {
                match rect {
                    Some((x, y, w, h, r)) => {
                        let s = |v: f64| (v * scale).round() as i32;
                        let rgn = CreateRoundRectRgn(s(x), s(y), s(x + w) + 1, s(y + h) + 1, s(r * 2.0), s(r * 2.0));
                        SetWindowRgn(hwnd, rgn, 1);
                    }
                    None => {
                        SetWindowRgn(hwnd, std::ptr::null_mut(), 1);
                    }
                }
            }
        }
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    let _ = (window, rect);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_stays_centered_on_the_pill() {
        // Píldora de 320 px en x=640: el panel de 460 px queda centrado (x=570).
        assert_eq!(layout((640, 10), 320, (460, 640), Some((0, 0, 1600, 900))), (570, 10));
    }

    #[test]
    fn panel_is_clamped_inside_the_monitor() {
        assert_eq!(layout((0, 10), 320, (460, 640), Some((0, 0, 1600, 900))), (0, 10));
        assert_eq!(layout((1300, 10), 320, (460, 640), Some((0, 0, 1600, 900))), (1140, 10));
        // Píldora abajo: el panel sube para caber.
        assert_eq!(layout((640, 800), 320, (460, 640), Some((0, 0, 1600, 900))), (570, 260));
    }

    #[test]
    fn respects_secondary_monitor_origin() {
        assert_eq!(layout((1700, 10), 320, (460, 640), Some((1600, 0, 1920, 1080))), (1630, 10));
    }

    #[test]
    fn parses_modes() {
        assert_eq!(Mode::parse("panel"), Mode::Panel);
        assert_eq!(Mode::parse("capture"), Mode::Capture);
        assert_eq!(Mode::parse("media"), Mode::Media);
        assert_eq!(Mode::parse("otra"), Mode::Pill);
    }
}
