//! Controles multimedia: MPRIS (D-Bus) en Linux y GSMTC en Windows.
//! Elige solo el reproductor que está sonando, salvo que el usuario fije uno.

use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct PlayerInfo {
    pub id: String,
    pub name: String,
    pub status: String,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct MediaState {
    pub player: String,
    pub name: String,
    pub players: Vec<PlayerInfo>,
    pub pinned: bool,
    /// "Playing" | "Paused" | "Stopped"
    pub status: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Clave de la carátula para pedirla con `media_art`.
    pub art: Option<String>,
    pub length: f64,
    pub position: f64,
    pub can_control: bool,
    pub can_seek: bool,
    pub track: String,
}

pub struct Media {
    pub pinned: Mutex<Option<String>>,
    last_active: Mutex<HashMap<String, Instant>>,
    art_cache: Mutex<VecDeque<(String, String)>>,
    last: Mutex<MediaState>,
}

impl Media {
    pub fn new() -> Self {
        Media { pinned: Mutex::new(None), last_active: Mutex::new(HashMap::new()), art_cache: Mutex::new(VecDeque::new()), last: Mutex::new(MediaState::default()) }
    }

    pub fn current(&self) -> MediaState {
        self.last.lock().unwrap().clone()
    }
}

/// Reproductor a mostrar: el fijado; si no, el último que sonó; si no, el primero.
pub fn pick_player(players: &[PlayerInfo], pinned: Option<&str>, last_active: &HashMap<String, Instant>) -> Option<String> {
    if let Some(p) = pinned.filter(|p| players.iter().any(|x| x.id == *p)) {
        return Some(p.to_string());
    }
    let recency = |id: &str| last_active.get(id).copied();
    let best = |filter: &dyn Fn(&PlayerInfo) -> bool| {
        players.iter().filter(|p| filter(p)).max_by_key(|p| recency(&p.id)).map(|p| p.id.clone())
    };
    best(&|p| p.status == "Playing")
        .or_else(|| best(&|p| p.status == "Paused" && recency(&p.id).is_some()))
        .or_else(|| best(&|p| p.status == "Paused"))
        .or_else(|| players.first().map(|p| p.id.clone()))
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || {
        #[cfg(windows)]
        unsafe {
            let _ = windows::Win32::System::WinRT::RoInitialize(windows::Win32::System::WinRT::RO_INIT_MULTITHREADED);
        }
        let mut last_sent: Option<MediaState> = None;
        loop {
            let media = app.state::<Media>();
            let state = backend::snapshot(&media).unwrap_or_default();
            *media.last.lock().unwrap() = state.clone();
            // Evitamos mandar eventos si nada cambió (la posición se redondea al segundo).
            let mut cmp = state.clone();
            cmp.position = cmp.position.round();
            if last_sent.as_ref() != Some(&cmp) {
                let _ = app.emit("media", &state);
                last_sent = Some(cmp);
            }
            let idle = state.players.is_empty();
            thread::sleep(Duration::from_millis(if idle { 2500 } else { 1000 }));
        }
    });
}

/* ---------------- Carátulas ---------------- */

const MAX_ART: usize = 4 * 1024 * 1024;

fn mime_for(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, ..] => "image/jpeg",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ => "image/jpeg",
    }
}

pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn to_data_url(bytes: &[u8]) -> String {
    format!("data:{};base64,{}", mime_for(bytes), base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Devuelve la carátula como `data:` URL (con caché de las últimas 12).
pub fn art(media: &Media, key: &str) -> Result<String, String> {
    if let Some((_, v)) = media.art_cache.lock().unwrap().iter().find(|(k, _)| k == key) {
        return Ok(v.clone());
    }
    let bytes = if let Some(path) = key.strip_prefix("file://") {
        let path = percent_decode(path);
        let data = std::fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
        if data.len() > MAX_ART {
            return Err("Carátula demasiado grande".into());
        }
        data
    } else if key.starts_with("https://") || key.starts_with("http://") {
        let resp = ureq::AgentBuilder::new().timeout(Duration::from_secs(6)).build().get(key).call().map_err(|e| e.to_string())?;
        let mut data = Vec::new();
        use std::io::Read;
        resp.into_reader().take(MAX_ART as u64).read_to_end(&mut data).map_err(|e| e.to_string())?;
        data
    } else {
        backend::native_art(key)?
    };
    let url = to_data_url(&bytes);
    let mut cache = media.art_cache.lock().unwrap();
    cache.push_back((key.to_string(), url.clone()));
    while cache.len() > 12 {
        cache.pop_front();
    }
    Ok(url)
}

pub fn control(media: &Media, action: &str) -> Result<(), String> {
    let state = media.current();
    if state.player.is_empty() {
        return Err("No hay ningún reproductor".into());
    }
    backend::control(&state, action)
}

pub fn seek(media: &Media, seconds: f64) -> Result<(), String> {
    let state = media.current();
    if !state.can_seek {
        return Err("Este reproductor no permite saltar".into());
    }
    backend::seek(&state, seconds.max(0.0))
}

/* ---------------- Linux: MPRIS ---------------- */

#[cfg(target_os = "linux")]
mod backend {
    use super::*;
    use std::sync::OnceLock;
    use zbus::blocking::Connection;
    use zbus::zvariant::{OwnedValue, Value};

    const PREFIX: &str = "org.mpris.MediaPlayer2.";
    const PATH: &str = "/org/mpris/MediaPlayer2";
    const PLAYER: &str = "org.mpris.MediaPlayer2.Player";
    const ROOT: &str = "org.mpris.MediaPlayer2";

    fn conn() -> Result<&'static Connection, String> {
        static CONN: OnceLock<Connection> = OnceLock::new();
        if let Some(c) = CONN.get() {
            return Ok(c);
        }
        let c = Connection::session().map_err(|e| e.to_string())?;
        Ok(CONN.get_or_init(|| c))
    }

    fn get_all(c: &Connection, dest: &str, iface: &str) -> Result<HashMap<String, OwnedValue>, String> {
        let reply = c
            .call_method(Some(dest), PATH, Some("org.freedesktop.DBus.Properties"), "GetAll", &(iface,))
            .map_err(|e| e.to_string())?;
        reply.body().deserialize::<HashMap<String, OwnedValue>>().map_err(|e| e.to_string())
    }

    pub fn as_str(v: &Value) -> Option<String> {
        match v {
            Value::Str(s) => Some(s.to_string()),
            Value::ObjectPath(p) => Some(p.to_string()),
            Value::Value(inner) => as_str(inner),
            _ => None,
        }
    }

    pub fn as_i64(v: &Value) -> Option<i64> {
        match v {
            Value::I64(n) => Some(*n),
            Value::U64(n) => Some(*n as i64),
            Value::I32(n) => Some(*n as i64),
            Value::U32(n) => Some(*n as i64),
            Value::F64(n) => Some(*n as i64),
            Value::Value(inner) => as_i64(inner),
            _ => None,
        }
    }

    pub fn as_bool(v: &Value) -> Option<bool> {
        match v {
            Value::Bool(b) => Some(*b),
            Value::Value(inner) => as_bool(inner),
            _ => None,
        }
    }

    pub fn as_strings(v: &Value) -> Vec<String> {
        match v {
            Value::Array(a) => a.iter().filter_map(as_str).collect(),
            Value::Value(inner) => as_strings(inner),
            other => as_str(other).into_iter().collect(),
        }
    }

    /// Metadatos MPRIS (a{sv}) → mapa de valores.
    pub fn metadata(v: &Value) -> HashMap<String, Value<'static>> {
        match v {
            Value::Dict(d) => d
                .iter()
                .filter_map(|(k, val)| Some((as_str(k)?, val.try_to_owned().ok()?.into())))
                .collect(),
            Value::Value(inner) => metadata(inner),
            _ => HashMap::new(),
        }
    }

    pub fn snapshot(media: &Media) -> Result<MediaState, String> {
        let c = conn()?;
        let names: Vec<String> = c
            .call_method(Some("org.freedesktop.DBus"), "/org/freedesktop/DBus", Some("org.freedesktop.DBus"), "ListNames", &())
            .map_err(|e| e.to_string())?
            .body()
            .deserialize()
            .map_err(|e| e.to_string())?;

        let mut players = Vec::new();
        let mut props_by_player = HashMap::new();
        for name in names.into_iter().filter(|n| n.starts_with(PREFIX)) {
            let Ok(props) = get_all(c, &name, PLAYER) else { continue };
            let status = props.get("PlaybackStatus").and_then(|v| as_str(v)).unwrap_or_else(|| "Stopped".into());
            let identity = get_all(c, &name, ROOT).ok().and_then(|r| r.get("Identity").and_then(|v| as_str(v)));
            let short = name[PREFIX.len()..].split('.').next().unwrap_or("").to_string();
            players.push(PlayerInfo { id: name.clone(), name: identity.unwrap_or(short), status });
            props_by_player.insert(name, props);
        }

        {
            let mut active = media.last_active.lock().unwrap();
            active.retain(|id, _| players.iter().any(|p| &p.id == id));
            for p in players.iter().filter(|p| p.status == "Playing") {
                active.insert(p.id.clone(), Instant::now());
            }
        }
        let pinned = media.pinned.lock().unwrap().clone();
        let chosen = pick_player(&players, pinned.as_deref(), &media.last_active.lock().unwrap());
        let Some(id) = chosen else { return Ok(MediaState::default()) };
        let props = &props_by_player[&id];
        let md = props.get("Metadata").map(|v| metadata(v)).unwrap_or_default();
        let get = |k: &str| md.get(k);
        let info = players.iter().find(|p| p.id == id).cloned().unwrap_or_default();
        let length = get("mpris:length").and_then(as_i64).unwrap_or(0) as f64 / 1e6;
        let title = get("xesam:title").and_then(as_str).unwrap_or_default();
        let artist = get("xesam:artist").map(as_strings).unwrap_or_default().join(", ");
        let track = get("mpris:trackid").and_then(as_str).unwrap_or_else(|| format!("{title}|{artist}"));
        Ok(MediaState {
            player: id.clone(),
            name: info.name,
            pinned: pinned.as_deref() == Some(id.as_str()),
            status: info.status,
            title,
            artist,
            album: get("xesam:album").and_then(as_str).unwrap_or_default(),
            art: get("mpris:artUrl").and_then(as_str).filter(|s| !s.is_empty()),
            length,
            position: (props.get("Position").and_then(|v| as_i64(v)).unwrap_or(0) as f64 / 1e6).clamp(0.0, if length > 0.0 { length } else { f64::MAX }),
            can_control: props.get("CanControl").and_then(|v| as_bool(v)).unwrap_or(true),
            can_seek: props.get("CanSeek").and_then(|v| as_bool(v)).unwrap_or(true) && length > 0.0,
            track,
            players,
        })
    }

    pub fn control(state: &MediaState, action: &str) -> Result<(), String> {
        let method = match action {
            "play-pause" => "PlayPause",
            "next" => "Next",
            "previous" => "Previous",
            _ => return Err("Acción desconocida".into()),
        };
        conn()?.call_method(Some(state.player.as_str()), PATH, Some(PLAYER), method, &()).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn seek(state: &MediaState, seconds: f64) -> Result<(), String> {
        let c = conn()?;
        let us = (seconds * 1e6) as i64;
        if let Ok(path) = zbus::zvariant::ObjectPath::try_from(state.track.as_str()) {
            if c.call_method(Some(state.player.as_str()), PATH, Some(PLAYER), "SetPosition", &(path, us)).is_ok() {
                return Ok(());
            }
        }
        // Sin trackid válido: salto relativo.
        let offset = us - (state.position * 1e6) as i64;
        c.call_method(Some(state.player.as_str()), PATH, Some(PLAYER), "Seek", &(offset,)).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn native_art(_key: &str) -> Result<Vec<u8>, String> {
        Err("Formato de carátula no compatible".into())
    }
}

/* ---------------- Windows: GSMTC ---------------- */

#[cfg(windows)]
mod backend {
    use super::*;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;

    fn manager() -> Result<Manager, String> {
        Manager::RequestAsync().and_then(|op| op.join()).map_err(|e| e.to_string())
    }

    fn status_name(s: Status) -> &'static str {
        if s == Status::Playing {
            "Playing"
        } else if s == Status::Paused {
            "Paused"
        } else {
            "Stopped"
        }
    }

    fn app_name(id: &str) -> String {
        // "Spotify.exe", "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"
        let base = id.rsplit('!').next().unwrap_or(id);
        let base = base.trim_end_matches(".exe").rsplit('.').next().unwrap_or(base);
        base.to_string()
    }

    fn session_for(id: &str) -> Result<Session, String> {
        let m = manager()?;
        let sessions = m.GetSessions().map_err(|e| e.to_string())?;
        for s in sessions {
            if s.SourceAppUserModelId().map(|x| x.to_string()).ok().as_deref() == Some(id) {
                return Ok(s);
            }
        }
        Err("El reproductor ya no está disponible".into())
    }

    pub fn snapshot(media: &Media) -> Result<MediaState, String> {
        let m = manager()?;
        let sessions = m.GetSessions().map_err(|e| e.to_string())?;
        let mut players = Vec::new();
        for s in &sessions {
            let id = s.SourceAppUserModelId().map(|x| x.to_string()).unwrap_or_default();
            let status = s.GetPlaybackInfo().and_then(|i| i.PlaybackStatus()).map(status_name).unwrap_or("Stopped");
            players.push(PlayerInfo { name: app_name(&id), id, status: status.into() });
        }
        {
            let mut active = media.last_active.lock().unwrap();
            active.retain(|id, _| players.iter().any(|p| &p.id == id));
            for p in players.iter().filter(|p| p.status == "Playing") {
                active.insert(p.id.clone(), Instant::now());
            }
        }
        let pinned = media.pinned.lock().unwrap().clone();
        let Some(id) = pick_player(&players, pinned.as_deref(), &media.last_active.lock().unwrap()) else { return Ok(MediaState::default()) };
        let session = sessions.into_iter().find(|s| s.SourceAppUserModelId().map(|x| x.to_string()).ok().as_deref() == Some(id.as_str()));
        let Some(session) = session else { return Ok(MediaState::default()) };
        let props = session.TryGetMediaPropertiesAsync().and_then(|op| op.join()).map_err(|e| e.to_string())?;
        let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
        let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
        let timeline = session.GetTimelineProperties().ok();
        let ticks = |d: Option<windows::Foundation::TimeSpan>| d.map(|t| t.Duration as f64 / 1e7).unwrap_or(0.0);
        let length = ticks(timeline.as_ref().and_then(|t| t.EndTime().ok())) - ticks(timeline.as_ref().and_then(|t| t.StartTime().ok()));
        let mut position = ticks(timeline.as_ref().and_then(|t| t.Position().ok()));
        // Windows solo actualiza la posición a ratos: la estimamos desde la última actualización.
        if let Some(updated) = timeline.as_ref().and_then(|t| t.LastUpdatedTime().ok()) {
            let info = players.iter().find(|p| p.id == id);
            if info.map(|p| p.status == "Playing").unwrap_or(false) {
                let now_ft = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs_f64())
                    .unwrap_or(0.0);
                // UniversalTime: intervalos de 100 ns desde 1601-01-01.
                let updated_unix = updated.UniversalTime as f64 / 1e7 - 11_644_473_600.0;
                position += (now_ft - updated_unix).max(0.0);
            }
        }
        let controls = session.GetPlaybackInfo().and_then(|i| i.Controls()).ok();
        let can_seek = controls.as_ref().and_then(|c| c.IsPlaybackPositionEnabled().ok()).unwrap_or(false) && length > 0.0;
        let info = players.iter().find(|p| p.id == id).cloned().unwrap_or_default();
        let has_thumb = props.Thumbnail().is_ok();
        Ok(MediaState {
            player: id.clone(),
            name: info.name,
            pinned: pinned.as_deref() == Some(id.as_str()),
            status: info.status,
            art: has_thumb.then(|| format!("gsmtc:{id}|{title}|{artist}")),
            track: format!("{title}|{artist}"),
            title,
            artist,
            album: props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default(),
            length: length.max(0.0),
            position: if length > 0.0 { position.clamp(0.0, length) } else { 0.0 },
            can_control: true,
            can_seek,
            players,
        })
    }

    pub fn control(state: &MediaState, action: &str) -> Result<(), String> {
        let s = session_for(&state.player)?;
        let op = match action {
            "play-pause" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "previous" => s.TrySkipPreviousAsync(),
            _ => return Err("Acción desconocida".into()),
        };
        op.and_then(|o| o.join()).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn seek(state: &MediaState, seconds: f64) -> Result<(), String> {
        let s = session_for(&state.player)?;
        s.TryChangePlaybackPositionAsync((seconds * 1e7) as i64).and_then(|o| o.join()).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn native_art(key: &str) -> Result<Vec<u8>, String> {
        let id = key.strip_prefix("gsmtc:").and_then(|k| k.split('|').next()).ok_or("Clave de carátula no válida")?;
        let s = session_for(id)?;
        let props = s.TryGetMediaPropertiesAsync().and_then(|op| op.join()).map_err(|e| e.to_string())?;
        let stream = props.Thumbnail().and_then(|t| t.OpenReadAsync()).and_then(|op| op.join()).map_err(|e| e.to_string())?;
        let size = stream.Size().map_err(|e| e.to_string())? as usize;
        if size == 0 || size > MAX_ART {
            return Err("Carátula vacía o demasiado grande".into());
        }
        let reader = DataReader::CreateDataReader(&stream).map_err(|e| e.to_string())?;
        reader.LoadAsync(size as u32).and_then(|op| op.join()).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; size];
        reader.ReadBytes(&mut buf).map_err(|e| e.to_string())?;
        Ok(buf)
    }
}

/* ---------------- Otros sistemas ---------------- */

#[cfg(not(any(target_os = "linux", windows)))]
mod backend {
    use super::*;
    pub fn snapshot(_m: &Media) -> Result<MediaState, String> {
        Ok(MediaState::default())
    }
    pub fn control(_s: &MediaState, _a: &str) -> Result<(), String> {
        Err("No disponible".into())
    }
    pub fn seek(_s: &MediaState, _p: f64) -> Result<(), String> {
        Err("No disponible".into())
    }
    pub fn native_art(_k: &str) -> Result<Vec<u8>, String> {
        Err("No disponible".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(id: &str, status: &str) -> PlayerInfo {
        PlayerInfo { id: id.into(), name: id.into(), status: status.into() }
    }

    #[test]
    fn picks_the_playing_player() {
        let players = vec![p("vlc", "Paused"), p("spotify", "Playing"), p("firefox", "Stopped")];
        assert_eq!(pick_player(&players, None, &HashMap::new()).as_deref(), Some("spotify"));
    }

    #[test]
    fn pinned_player_wins_while_it_exists() {
        let players = vec![p("vlc", "Paused"), p("spotify", "Playing")];
        assert_eq!(pick_player(&players, Some("vlc"), &HashMap::new()).as_deref(), Some("vlc"));
        assert_eq!(pick_player(&players, Some("cerrado"), &HashMap::new()).as_deref(), Some("spotify"));
    }

    #[test]
    fn remembers_the_last_player_that_played() {
        let mut active = HashMap::new();
        let old = Instant::now() - Duration::from_secs(60);
        active.insert("vlc".to_string(), old);
        active.insert("spotify".to_string(), Instant::now());
        let players = vec![p("vlc", "Paused"), p("spotify", "Paused"), p("otro", "Paused")];
        assert_eq!(pick_player(&players, None, &active).as_deref(), Some("spotify"));
        assert_eq!(pick_player(&[], None, &active), None);
    }

    #[test]
    fn decodes_file_urls_and_detects_images() {
        assert_eq!(percent_decode("/home/ana/M%C3%BAsica/car%C3%A1tula%201.jpg"), "/home/ana/Música/carátula 1.jpg");
        assert_eq!(percent_decode("/sin/escapes.png"), "/sin/escapes.png");
        assert_eq!(mime_for(&[0x89, b'P', b'N', b'G', 0, 0]), "image/png");
        assert_eq!(mime_for(&[0xFF, 0xD8, 0xFF]), "image/jpeg");
        assert!(to_data_url(&[0xFF, 0xD8, 0xFF]).starts_with("data:image/jpeg;base64,"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn reads_mpris_values() {
        use zbus::zvariant::Value;
        assert_eq!(backend::as_str(&Value::from("Canción")).as_deref(), Some("Canción"));
        assert_eq!(backend::as_i64(&Value::from(240_000_000u64)), Some(240_000_000));
        assert_eq!(backend::as_i64(&Value::Value(Box::new(Value::from(5i64)))), Some(5));
        assert_eq!(backend::as_strings(&Value::from(vec!["A", "B"])), vec!["A", "B"]);
        assert_eq!(backend::as_bool(&Value::from(true)), Some(true));
    }

    /// Prueba con un reproductor MPRIS real en el bus de sesión:
    /// `dbus-run-session -- sh -c 'python3 tools/fake_player.py & sleep 1; cargo test mpris_live -- --ignored'`
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore]
    fn mpris_live() {
        let media = Media::new();
        let s = backend::snapshot(&media).unwrap();
        assert_eq!(s.name, "Fake Player");
        assert_eq!(s.title, "Midnight City");
        assert_eq!(s.artist, "M83");
        assert_eq!(s.status, "Playing");
        assert!((s.length - 244.0).abs() < 0.01);
        assert!(s.can_seek);
        *media.last.lock().unwrap() = s.clone();
        control(&media, "next").unwrap();
        std::thread::sleep(Duration::from_millis(300));
        let s2 = backend::snapshot(&media).unwrap();
        assert_eq!(s2.title, "Blinding Lights");
        *media.last.lock().unwrap() = s2.clone();
        control(&media, "play-pause").unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(backend::snapshot(&media).unwrap().status, "Paused");
        seek(&media, 42.0).unwrap();
    }
}
