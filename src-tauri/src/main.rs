// FocusPill: píldora flotante de productividad para Linux y Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod apps;
mod data;
mod http;
mod integrations;
mod media;
mod notifications;
mod system;
mod tracker;
mod window;

use std::{
    fs,
    sync::{atomic::Ordering, Mutex},
    thread,
    time::Duration,
};

use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

use tracker::Tracker;
use window::{Geometry, Mode, WinState};

/// Acción pendiente hasta que la interfaz esté lista para recibirla.
struct Pending {
    action: Mutex<Option<String>>,
    ready: std::sync::atomic::AtomicBool,
}

const EDITION: &str = if cfg!(feature = "licensing") { "store" } else { "community" };

fn show_main(app: &AppHandle) -> Option<WebviewWindow> {
    let window = app.get_webview_window("main")?;
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    Some(window)
}

/// Acciones externas: argumentos de línea de comandos, bandeja y atajos globales.
fn dispatch_action(app: &AppHandle, action: &str) {
    if show_main(app).is_none() {
        return;
    }
    let pending = app.state::<Pending>();
    if pending.ready.load(Ordering::Relaxed) {
        let _ = app.emit("pill-action", action.to_string());
    } else {
        // La interfaz aún arranca: la recogerá con take_pending_action.
        *pending.action.lock().unwrap() = Some(action.to_string());
    }
}

fn action_from_args(args: &[String]) -> Option<&'static str> {
    args.iter().skip(1).find_map(|a| match a.as_str() {
        "--capture" | "-c" => Some("capture"),
        "--toggle-focus" | "-f" => Some("toggle-focus"),
        "--toggle-panel" | "-p" => Some("toggle-panel"),
        "--plan" => Some("ai-plan"),
        "--tools" => Some("tools"),
        "--open" | "--show" | "-o" => Some("open"),
        _ => None,
    })
}

fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> impl std::future::Future<Output = Result<T, String>> {
    async move { tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())? }
}

/* ---------------- Datos ---------------- */

#[tauri::command]
fn load_state(app: AppHandle) -> Option<String> {
    data::read_state(&app)
}

#[tauri::command]
fn save_state(app: AppHandle, data: String) -> Result<(), String> {
    data::write_state(&app, &data)
}

#[tauri::command]
fn list_backups(app: AppHandle) -> Vec<String> {
    data::list_backups(&app)
}

#[tauri::command]
fn read_backup(app: AppHandle, day: String) -> Result<String, String> {
    data::read_backup(&app, &day)
}

#[tauri::command]
async fn export_data(app: AppHandle, data: String, suggested: String) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&suggested)
        .add_filter("Copia de FocusPill", &["json"])
        .blocking_save_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    data::write_private(&path, &data).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
async fn import_data(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().add_filter("Copia de FocusPill", &["json"]).blocking_pick_file();
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Value>(&text).map_err(|_| "Ese archivo no es una copia válida".to_string())?;
    Ok(Some(text))
}

/* ---------------- Ventana ---------------- */

#[tauri::command]
fn set_mode(window: WebviewWindow, state: tauri::State<WinState>, mode: String) {
    let mode = Mode::parse(&mode);
    window::place(&window, &state, mode);
    // Solo pedimos el teclado cuando el usuario va a escribir (panel o captura).
    // La isla de música, los avisos y las herramientas nunca interrumpen lo que escribes.
    if mode.wants_keyboard() {
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn set_input_region(window: WebviewWindow, rect: Option<[f64; 5]>) {
    window::set_input_region(&window, rect.map(|r| (r[0], r[1], r[2], r[3], r[4])));
}

#[tauri::command]
fn start_drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn reset_position(window: WebviewWindow, state: tauri::State<WinState>) {
    let monitor = state.monitor.lock().unwrap().clone();
    *state.anchor.lock().unwrap() = Some(window::default_anchor(&window, monitor.as_deref()));
    state.anchor_dirty.store(true, Ordering::Relaxed);
    let mode = *state.mode.lock().unwrap();
    window::place(&window, &state, mode);
}

#[tauri::command]
fn list_monitors(window: WebviewWindow) -> Vec<window::MonitorInfo> {
    window::monitors(&window)
}

#[tauri::command]
fn set_monitor(window: WebviewWindow, state: tauri::State<WinState>, name: Option<String>) {
    *state.monitor.lock().unwrap() = name.clone();
    *state.anchor.lock().unwrap() = Some(window::default_anchor(&window, name.as_deref()));
    state.anchor_dirty.store(true, Ordering::Relaxed);
    let mode = *state.mode.lock().unwrap();
    window::place(&window, &state, mode);
}

#[tauri::command]
fn hide_pill(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

/// Errores de la interfaz: se escriben en la terminal para poder diagnosticarlos.
#[tauri::command]
fn log_js(level: String, message: String) {
    eprintln!("focuspill [js {level}]: {message}");
}

#[tauri::command]
fn take_pending_action(pending: tauri::State<Pending>) -> Option<String> {
    pending.ready.store(true, Ordering::Relaxed);
    pending.action.lock().unwrap().take()
}

/* ---------------- Sistema ---------------- */

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
fn env_info() -> system::EnvInfo {
    system::env_info(EDITION)
}

#[tauri::command]
async fn set_dnd(dnd: tauri::State<'_, system::Dnd>, on: bool) -> Result<(), String> {
    dnd.set(on)
}

#[tauri::command]
async fn setup_system_shortcuts(app: AppHandle) -> Result<String, String> {
    let msg = blocking(system::setup_system_shortcuts).await?;
    // Si el escritorio gestiona los atajos, la app deja de capturarlos para no duplicarlos.
    let _ = app.global_shortcut().unregister_all();
    Ok(msg)
}

#[tauri::command]
fn set_app_shortcuts(app: AppHandle, enabled: bool) {
    let _ = app.global_shortcut().unregister_all();
    if enabled {
        register_shortcuts(&app);
    }
}

#[tauri::command]
fn set_tracking(tracker: tauri::State<Tracker>, enabled: bool) {
    tracker.enabled.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn get_usage(tracker: tauri::State<Tracker>) -> tracker::Usage {
    tracker.usage.lock().unwrap().clone()
}

#[tauri::command]
fn clear_usage(app: AppHandle, tracker: tauri::State<Tracker>) {
    tracker.usage.lock().unwrap().clear();
    if let Some(p) = data::data_file(&app, "usage.json") {
        let _ = fs::remove_file(p);
    }
}

/// La interfaz informa de su zona horaria para que Rust use el mismo "hoy".
#[tauri::command]
fn set_utc_offset(minutes: i64) {
    tracker::UTC_OFFSET_MIN.store(minutes, Ordering::Relaxed);
}

/* ---------------- IA ---------------- */

#[tauri::command]
fn ai_status() -> Value {
    ai::status()
}

#[tauri::command]
async fn ai_models(config: ai::ClientConfig) -> Result<Vec<String>, String> {
    blocking(move || ai::list_models(&config)).await
}

#[tauri::command]
async fn ai_chat(config: ai::ClientConfig, messages: Value, json: bool) -> Result<String, String> {
    blocking(move || ai::chat(&config, &messages, json)).await
}

/* ---------------- Lanzador de modos ---------------- */

#[tauri::command]
async fn list_apps() -> Result<Vec<apps::AppEntry>, String> {
    blocking(|| Ok(apps::list())).await
}

#[tauri::command]
fn launch_app(id: String) -> Result<(), String> {
    apps::launch(&id)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    apps::open_url(&url)
}

/* ---------------- Multimedia ---------------- */

#[tauri::command]
fn media_state(media: tauri::State<media::Media>) -> media::MediaState {
    media.current()
}

#[tauri::command]
async fn media_control(app: AppHandle, action: String) -> Result<(), String> {
    blocking(move || media::control(&app.state::<media::Media>(), &action)).await
}

#[tauri::command]
async fn media_seek(app: AppHandle, seconds: f64) -> Result<(), String> {
    blocking(move || media::seek(&app.state::<media::Media>(), seconds)).await
}

#[tauri::command]
async fn media_art(app: AppHandle, key: String) -> Result<String, String> {
    blocking(move || media::art(&app.state::<media::Media>(), &key)).await
}

/// Fija un reproductor (o vuelve a la elección automática con `None`).
#[tauri::command]
fn media_pin(media: tauri::State<media::Media>, player: Option<String>) {
    *media.pinned.lock().unwrap() = player;
}

/* ---------------- Notificaciones ---------------- */

/// Activa o desactiva la escucha de notificaciones (desactivada por defecto).
#[tauri::command]
fn set_notifications(app: AppHandle, enabled: bool) -> Result<(), String> {
    if !notifications::SUPPORTED {
        return Err("En Windows llegará con la versión de Microsoft Store".into());
    }
    notifications::set_enabled(&app, enabled);
    Ok(())
}

/* ---------------- Integraciones ---------------- */

#[tauri::command]
async fn fetch_calendar(url: String) -> Result<String, String> {
    blocking(move || integrations::fetch_calendar(&url)).await
}

#[tauri::command]
async fn todoist_today(token: String) -> Result<Vec<integrations::RemoteTask>, String> {
    blocking(move || integrations::todoist_today(&token)).await
}

#[tauri::command]
async fn todoist_close(token: String, id: String) -> Result<(), String> {
    blocking(move || integrations::todoist_close(&token, &id)).await
}

#[tauri::command]
async fn notion_append(token: String, page: String, title: String, text: String) -> Result<(), String> {
    blocking(move || integrations::notion_append(&token, &page, &title, &text)).await
}

/* ---------------- Licencia ---------------- */

#[cfg(feature = "licensing")]
fn license_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    data::data_file(app, "license.json")
}

#[tauri::command]
fn license_status(app: AppHandle) -> Value {
    #[cfg(feature = "licensing")]
    {
        let stored = license_path(&app)
            .and_then(|p| fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<Value>(&s).ok());
        let pro = stored.as_ref().and_then(|v| v["valid"].as_bool()).unwrap_or(false);
        serde_json::json!({ "edition": EDITION, "pro": pro, "key": stored.and_then(|v| v["key"].as_str().map(|k| format!("…{}", &k[k.len().saturating_sub(4)..]))) })
    }
    #[cfg(not(feature = "licensing"))]
    {
        let _ = app;
        serde_json::json!({ "edition": EDITION, "pro": true })
    }
}

#[tauri::command]
async fn license_activate(app: AppHandle, key: String) -> Result<(), String> {
    #[cfg(feature = "licensing")]
    {
        let instance = format!("focuspill-{}", std::env::var("HOSTNAME").or_else(|_| std::env::var("COMPUTERNAME")).unwrap_or_else(|_| "pc".into()));
        let k = key.clone();
        let id = blocking(move || integrations::license::activate(&k, &instance)).await?;
        let path = license_path(&app).ok_or("sin carpeta de datos")?;
        let json = serde_json::json!({ "key": key.trim(), "instance_id": id, "valid": true }).to_string();
        data::write_private(&path, &json).map_err(|e| e.to_string())
    }
    #[cfg(not(feature = "licensing"))]
    {
        let _ = (app, key);
        Ok(())
    }
}

#[cfg(feature = "licensing")]
fn revalidate_license(app: AppHandle) {
    thread::spawn(move || {
        let Some(path) = license_path(&app) else { return };
        let Some(mut v) = fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) else { return };
        let (Some(key), Some(id)) = (v["key"].as_str().map(String::from), v["instance_id"].as_str().map(String::from)) else { return };
        // Sin conexión mantenemos el último resultado conocido.
        if let Ok(valid) = integrations::license::validate(&key, &id) {
            v["valid"] = Value::Bool(valid);
            let _ = data::write_private(&path, &v.to_string());
        }
    });
}

/* ---------------- Actualizaciones ---------------- */

/// Traduce los errores del actualizador a algo que el usuario pueda entender.
fn update_error(e: impl std::fmt::Display) -> String {
    let e = e.to_string();
    if e.contains("valid release JSON") || e.contains("404") {
        "Aún no hay ninguna versión publicada en GitHub. Vuelve a intentarlo más tarde.".into()
    } else if e.contains("signature") {
        "La actualización no tiene una firma válida y no se ha instalado.".into()
    } else if e.contains("dns") || e.contains("connect") || e.contains("network") {
        "Sin conexión con GitHub. Revisa tu conexión a internet.".into()
    } else {
        format!("No se pudo comprobar: {e}")
    }
}

#[cfg(test)]
mod update_tests {
    use super::update_error;

    #[test]
    fn explains_update_errors() {
        assert!(update_error("Could not fetch a valid release JSON from the remote").starts_with("Aún no hay"));
        assert!(update_error("invalid signature").contains("firma"));
        assert!(update_error("raro").starts_with("No se pudo"));
    }
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<Value>, String> {
    let updater = app.updater().map_err(update_error)?;
    match updater.check().await.map_err(update_error)? {
        Some(u) => Ok(Some(serde_json::json!({ "version": u.version, "notes": u.body }))),
        None => Ok(None),
    }
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(update_error)?;
    let Some(update) = updater.check().await.map_err(update_error)? else { return Ok(()) };
    update.download_and_install(|_, _| {}, || {}).await.map_err(update_error)?;
    app.restart();
}

/* ---------------- Arranque ---------------- */

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir panel", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Captura rápida", true, None::<&str>)?;
    let focus = MenuItem::with_id(app, "toggle-focus", "Iniciar / pausar foco", true, None::<&str>)?;
    let plan = MenuItem::with_id(app, "ai-plan", "Planificar mi día (IA)", true, None::<&str>)?;
    let visibility = MenuItem::with_id(app, "toggle-visible", "Mostrar / ocultar píldora", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset-position", "Volver arriba al centro", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &capture, &focus, &plan, &sep, &visibility, &reset, &sep2, &quit])?;

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
                    let state = app.state::<WinState>();
                    let monitor = state.monitor.lock().unwrap().clone();
                    *state.anchor.lock().unwrap() = Some(window::default_anchor(&w, monitor.as_deref()));
                    state.anchor_dirty.store(true, Ordering::Relaxed);
                    let _ = app.emit("pill-action", "collapse");
                    window::place(&w, &state, Mode::Pill);
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

fn shortcuts() -> [(Shortcut, &'static str); 4] {
    [
        (Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space), "capture"),
        (Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyF), "toggle-focus"),
        (Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyP), "toggle-panel"),
        (Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyH), "tools"),
    ]
}

fn register_shortcuts(app: &AppHandle) {
    for (sc, _) in shortcuts() {
        if let Err(e) = app.global_shortcut().register(sc) {
            eprintln!("focuspill: no se pudo registrar el atajo {sc:?}: {e}");
        }
    }
}

/// Guarda posición y uso de apps en segundo plano, sin bloquear la interfaz.
fn spawn_saver(app: AppHandle) {
    thread::spawn(move || {
        let mut ticks = 0u32;
        loop {
            thread::sleep(Duration::from_millis(1500));
            ticks += 1;
            let state = app.state::<WinState>();
            if state.anchor_dirty.swap(false, Ordering::Relaxed) {
                let anchor = *state.anchor.lock().unwrap();
                let monitor = state.monitor.lock().unwrap().clone();
                if let (Some((x, y)), Some(path)) = (anchor, data::data_file(&app, "geometry.json")) {
                    if let Ok(json) = serde_json::to_string(&Geometry { x, y, monitor }) {
                        let _ = data::write_private(&path, &json);
                    }
                }
            }
            if ticks % 40 == 0 {
                let tracker = app.state::<Tracker>();
                if tracker.take_dirty() {
                    let usage = tracker.usage.lock().unwrap().clone();
                    if let (Ok(json), Some(path)) = (serde_json::to_string(&usage), data::data_file(&app, "usage.json")) {
                        let _ = data::write_private(&path, &json);
                    }
                }
            }
        }
    });
}

fn main() {
    window::prepare_linux_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            dispatch_action(app, action_from_args(&argv).unwrap_or("open"));
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if let Some((_, action)) = shortcuts().into_iter().find(|(sc, _)| sc == shortcut) {
                        dispatch_action(app, action);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(WinState::new())
        .manage(Pending { action: Mutex::new(None), ready: std::sync::atomic::AtomicBool::new(false) })
        .manage(system::Dnd::new())
        .manage(media::Media::new())
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            list_backups,
            read_backup,
            export_data,
            import_data,
            set_mode,
            set_input_region,
            start_drag,
            reset_position,
            list_monitors,
            set_monitor,
            hide_pill,
            quit,
            take_pending_action,
            log_js,
            notify,
            get_autostart,
            set_autostart,
            env_info,
            set_dnd,
            setup_system_shortcuts,
            set_app_shortcuts,
            set_tracking,
            get_usage,
            clear_usage,
            set_utc_offset,
            ai_status,
            ai_models,
            ai_chat,
            fetch_calendar,
            todoist_today,
            todoist_close,
            notion_append,
            media_state,
            list_apps,
            launch_app,
            open_url,
            media_control,
            media_seek,
            media_art,
            media_pin,
            set_notifications,
            license_status,
            license_activate,
            check_update,
            install_update
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            let args: Vec<String> = std::env::args().collect();
            *app.state::<Pending>().action.lock().unwrap() = action_from_args(&args).map(String::from);

            let usage = data::data_file(&handle, "usage.json")
                .and_then(|p| fs::read_to_string(p).ok())
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            app.manage(Tracker::new(usage));

            let window = app.get_webview_window("main").expect("ventana principal");
            let state = app.state::<WinState>();
            if let Some(geo) = data::data_file(&handle, "geometry.json")
                .and_then(|p| fs::read_to_string(p).ok())
                .and_then(|s| serde_json::from_str::<Geometry>(&s).ok())
            {
                *state.monitor.lock().unwrap() = geo.monitor;
                // Si la posición guardada ya no cae en ningún monitor, volvemos arriba al centro.
                if window::anchor_on_screen(&window, (geo.x, geo.y)) {
                    *state.anchor.lock().unwrap() = Some((geo.x, geo.y));
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

            window::place(&window, &state, Mode::Pill);
            show_main(&handle);

            if let Err(e) = build_tray(&handle) {
                eprintln!("focuspill: bandeja no disponible: {e}");
            }
            register_shortcuts(&handle);
            spawn_saver(handle.clone());
            tracker::spawn(handle.clone());
            media::spawn(handle.clone());
            #[cfg(feature = "licensing")]
            revalidate_license(handle);
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Moved(pos) => {
                let state = window.state::<WinState>();
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_cli_arguments_to_actions() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(action_from_args(&args(&["focuspill", "--capture"])), Some("capture"));
        assert_eq!(action_from_args(&args(&["focuspill", "-f"])), Some("toggle-focus"));
        assert_eq!(action_from_args(&args(&["focuspill", "--toggle-panel"])), Some("toggle-panel"));
        assert_eq!(action_from_args(&args(&["focuspill", "--plan"])), Some("ai-plan"));
        assert_eq!(action_from_args(&args(&["focuspill"])), None);
    }
}
