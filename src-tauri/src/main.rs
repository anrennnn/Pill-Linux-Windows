// FocusPill: píldora flotante de productividad para escritorios Linux.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

/// Tamaños lógicos de la ventana para cada modo. La píldora visible se dibuja
/// centrada arriba dentro de la ventana; el resto es margen transparente para la sombra.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Mode {
    Pill,
    Capture,
    Panel,
}

impl Mode {
    fn parse(s: &str) -> Mode {
        match s {
            "capture" => Mode::Capture,
            "panel" => Mode::Panel,
            _ => Mode::Pill,
        }
    }

    fn size(self) -> (f64, f64) {
        match self {
            Mode::Pill => (320.0, 60.0),
            Mode::Capture => (520.0, 72.0),
            Mode::Panel => (440.0, 600.0),
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Geometry {
    x: i32,
    y: i32,
}

struct AppState {
    mode: Mutex<Mode>,
    /// Esquina superior izquierda de la ventana en modo píldora (px físicos).
    anchor: Mutex<Option<(i32, i32)>>,
    anchor_dirty: AtomicBool,
    /// Los movimientos que provocamos nosotros no deben cambiar el ancla.
    last_place: Mutex<Instant>,
    pending_action: Mutex<Option<String>>,
}

fn data_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join(name))
}

fn write_atomic(path: &PathBuf, data: &str) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data)?;
    fs::rename(tmp, path)
}

/// Las sesiones Wayland no permiten a una app fijar su posición ni mantenerse
/// encima de las demás, así que usamos XWayland salvo que el usuario lo desactive.
fn prepare_linux_env() {
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

fn default_anchor(window: &WebviewWindow) -> (i32, i32) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let pill_w = (Mode::Pill.size().0 * scale) as i32;
    match window.primary_monitor().ok().flatten() {
        Some(m) => {
            let pos = m.position();
            let size = m.size();
            (pos.x + (size.width as i32 - pill_w) / 2, pos.y + (10.0 * scale) as i32)
        }
        None => (200, 10),
    }
}

/// Monitor que contiene el punto dado, o el principal si no hay ninguno.
fn monitor_bounds(window: &WebviewWindow, x: i32, y: i32) -> Option<(i32, i32, i32, i32)> {
    let monitors = window.available_monitors().ok()?;
    let hit = monitors.iter().find(|m| {
        let p = m.position();
        let s = m.size();
        x >= p.x && x < p.x + s.width as i32 && y >= p.y && y < p.y + s.height as i32
    });
    let m = match hit {
        Some(m) => m.clone(),
        None => window.primary_monitor().ok().flatten()?,
    };
    let p = m.position();
    let s = m.size();
    Some((p.x, p.y, s.width as i32, s.height as i32))
}

fn place(window: &WebviewWindow, state: &AppState, mode: Mode) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let (w, h) = mode.size();
    let (pw, ph) = ((w * scale) as i32, (h * scale) as i32);
    let pill_w = (Mode::Pill.size().0 * scale) as i32;

    let anchor = {
        let mut a = state.anchor.lock().unwrap();
        if a.is_none() {
            *a = Some(default_anchor(window));
        }
        a.unwrap()
    };

    let center_x = anchor.0 + pill_w / 2;
    let mut x = center_x - pw / 2;
    let mut y = anchor.1;
    if let Some((mx, my, mw, mh)) = monitor_bounds(window, center_x, anchor.1) {
        x = x.clamp(mx, (mx + mw - pw).max(mx));
        if y + ph > my + mh {
            y = (my + mh - ph).max(my);
        }
        y = y.max(my);
    }

    *state.mode.lock().unwrap() = mode;
    *state.last_place.lock().unwrap() = Instant::now();
    let _ = window.set_size(PhysicalSize::new(pw as u32, ph as u32));
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn show_main(app: &AppHandle) -> Option<WebviewWindow> {
    let window = app.get_webview_window("main")?;
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    Some(window)
}

/// Acciones externas: argumentos de línea de comandos, bandeja y atajos globales.
fn dispatch_action(app: &AppHandle, action: &str) {
    if show_main(app).is_some() {
        let _ = app.emit("pill-action", action.to_string());
    }
}

fn action_from_args(args: &[String]) -> Option<&'static str> {
    args.iter().skip(1).find_map(|a| match a.as_str() {
        "--capture" | "-c" => Some("capture"),
        "--toggle-focus" | "-f" => Some("toggle-focus"),
        "--open" | "--show" | "-o" => Some("open"),
        _ => None,
    })
}

#[tauri::command]
fn load_state(app: AppHandle) -> Option<String> {
    fs::read_to_string(data_file(&app, "state.json")?).ok()
}

#[tauri::command]
fn save_state(app: AppHandle, data: String) -> Result<(), String> {
    let path = data_file(&app, "state.json").ok_or("sin carpeta de datos")?;
    write_atomic(&path, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_mode(window: WebviewWindow, state: tauri::State<AppState>, mode: String) {
    let mode = Mode::parse(&mode);
    place(&window, &state, mode);
    if mode != Mode::Pill {
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn start_drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn reset_position(window: WebviewWindow, state: tauri::State<AppState>) {
    let anchor = default_anchor(&window);
    *state.anchor.lock().unwrap() = Some(anchor);
    state.anchor_dirty.store(true, Ordering::Relaxed);
    let mode = *state.mode.lock().unwrap();
    place(&window, &state, mode);
}

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) {
    let _ = app.notification().builder().title(title).body(body).show();
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|e| e.to_string())
}

#[tauri::command]
fn take_pending_action(state: tauri::State<AppState>) -> Option<String> {
    state.pending_action.lock().unwrap().take()
}

#[tauri::command]
fn hide_pill(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir panel", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Captura rápida", true, None::<&str>)?;
    let focus = MenuItem::with_id(app, "toggle-focus", "Iniciar / pausar foco", true, None::<&str>)?;
    let visibility = MenuItem::with_id(app, "toggle-visible", "Mostrar / ocultar píldora", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset-position", "Volver arriba al centro", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &capture, &focus, &sep, &visibility, &reset, &sep, &quit])?;

    let mut tray = TrayIconBuilder::with_id("focuspill")
        .menu(&menu)
        .tooltip("FocusPill")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
            "toggle-visible" => {
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        show_main(app);
                    }
                }
            }
            "reset-position" => {
                if let Some(w) = show_main(app) {
                    let state = app.state::<AppState>();
                    *state.anchor.lock().unwrap() = Some(default_anchor(&w));
                    state.anchor_dirty.store(true, Ordering::Relaxed);
                    place(&w, &state, Mode::Pill);
                    let _ = app.emit("pill-action", "collapse");
                }
            }
            other => dispatch_action(app, other),
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn register_shortcuts(app: &AppHandle) {
    let shortcuts = [
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyF),
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP),
    ];
    for sc in shortcuts {
        if let Err(e) = app.global_shortcut().register(sc) {
            eprintln!("focuspill: no se pudo registrar el atajo {sc:?}: {e}");
        }
    }
}

fn spawn_geometry_saver(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(1500));
        let state = app.state::<AppState>();
        if !state.anchor_dirty.swap(false, Ordering::Relaxed) {
            continue;
        }
        let anchor = *state.anchor.lock().unwrap();
        if let (Some((x, y)), Some(path)) = (anchor, data_file(&app, "geometry.json")) {
            if let Ok(json) = serde_json::to_string(&Geometry { x, y }) {
                let _ = write_atomic(&path, &json);
            }
        }
    });
}

fn main() {
    prepare_linux_env();

    let capture_sc = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    let focus_sc = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyF);
    let panel_sc = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let action = action_from_args(&argv).unwrap_or("open");
            dispatch_action(app, action);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &capture_sc {
                        dispatch_action(app, "capture");
                    } else if shortcut == &focus_sc {
                        dispatch_action(app, "toggle-focus");
                    } else if shortcut == &panel_sc {
                        dispatch_action(app, "toggle-panel");
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            mode: Mutex::new(Mode::Pill),
            anchor: Mutex::new(None),
            anchor_dirty: AtomicBool::new(false),
            last_place: Mutex::new(Instant::now()),
            pending_action: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            set_mode,
            start_drag,
            reset_position,
            notify,
            get_autostart,
            set_autostart,
            take_pending_action,
            hide_pill,
            quit
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let state = app.state::<AppState>();

            let args: Vec<String> = std::env::args().collect();
            *state.pending_action.lock().unwrap() = action_from_args(&args).map(String::from);

            if let Some(geo) = data_file(&handle, "geometry.json")
                .and_then(|p| fs::read_to_string(p).ok())
                .and_then(|s| serde_json::from_str::<Geometry>(&s).ok())
            {
                *state.anchor.lock().unwrap() = Some((geo.x, geo.y));
            }

            let window = app.get_webview_window("main").expect("ventana principal");
            // Si la posición guardada ya no cae en ningún monitor, volvemos al centro.
            let saved = *state.anchor.lock().unwrap();
            if let Some((x, y)) = saved {
                let on_screen = window
                    .available_monitors()
                    .map(|ms| {
                        ms.iter().any(|m| {
                            let p = m.position();
                            let s = m.size();
                            x >= p.x - 50 && x < p.x + s.width as i32 && y >= p.y - 50 && y < p.y + s.height as i32
                        })
                    })
                    .unwrap_or(false);
                if !on_screen {
                    *state.anchor.lock().unwrap() = None;
                }
            }

            #[cfg(target_os = "linux")]
            {
                use gtk::prelude::GtkWindowExt;
                if let Ok(gtk_window) = window.gtk_window() {
                    gtk_window.set_skip_pager_hint(true);
                    gtk_window.set_skip_taskbar_hint(true);
                    gtk_window.set_keep_above(true);
                    gtk_window.stick();
                }
            }

            place(&window, &state, Mode::Pill);
            show_main(&handle);

            if let Err(e) = build_tray(&handle) {
                eprintln!("focuspill: bandeja no disponible: {e}");
            }
            register_shortcuts(&handle);
            spawn_geometry_saver(handle);
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Moved(pos) => {
                let state = window.state::<AppState>();
                let settled = state.last_place.lock().unwrap().elapsed() > Duration::from_millis(400);
                if settled && *state.mode.lock().unwrap() == Mode::Pill {
                    *state.anchor.lock().unwrap() = Some((pos.x, pos.y));
                    state.anchor_dirty.store(true, Ordering::Relaxed);
                }
            }
            WindowEvent::Focused(false) => {
                let _ = window.emit("pill-blur", ());
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error al iniciar FocusPill");
}
