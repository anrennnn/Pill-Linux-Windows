//! Capa de IA. Todo proveedor habla el subconjunto "chat completions" de la API
//! de OpenAI, que ya implementan Ollama, LM Studio, llama.cpp, Jan, vLLM y LocalAI.
//! Una distro puede publicar su propio servicio con un archivo `ai-provider.json`
//! (ver docs/DISTRO-AI.md).

use std::{path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::http;

#[derive(Deserialize, Serialize, Clone, Debug, Default)]
pub struct ProviderFile {
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_api")]
    pub api: String,
    pub endpoint: String,
    #[serde(default)]
    pub base_path: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_key_file: Option<String>,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    #[serde(default = "default_true")]
    pub supports_json: bool,
}

fn default_api() -> String {
    "openai-chat".into()
}
fn default_true() -> bool {
    true
}

/// Configuración que manda la interfaz en cada llamada.
#[derive(Deserialize, Debug, Clone)]
pub struct ClientConfig {
    /// "distro" | "custom"
    pub provider: String,
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct DistroInfo {
    pub name: String,
    pub endpoint: String,
    pub model: Option<String>,
    pub source: String,
}

struct Target {
    endpoint: String,
    base_path: String,
    model: String,
    api_key: Option<String>,
    timeout: Duration,
    supports_json: bool,
}

fn expand_vars(s: &str) -> String {
    let mut out = s.to_string();
    let runtime = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| format!("/run/user/{}", current_uid()));
    out = out.replace("${XDG_RUNTIME_DIR}", &runtime);
    if let Ok(home) = std::env::var("HOME") {
        out = out.replace("${HOME}", &home);
    }
    out.replace("${UID}", &current_uid().to_string())
}

#[cfg(unix)]
fn current_uid() -> u32 {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata("/proc/self").map(|m| m.uid()).unwrap_or(1000)
}
#[cfg(not(unix))]
fn current_uid() -> u32 {
    0
}

/// Rutas donde una distro o el usuario pueden declarar su proveedor de IA, por prioridad.
pub fn discovery_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(p) = std::env::var_os("FOCUSPILL_AI_PROVIDER") {
        paths.push(PathBuf::from(p));
    }
    let config_home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
    if let Some(dir) = config_home {
        paths.push(dir.join("focuspill/ai-provider.json"));
    }
    let config_dirs = std::env::var("XDG_CONFIG_DIRS").unwrap_or_else(|_| "/etc/xdg".into());
    for dir in config_dirs.split(':').filter(|d| !d.is_empty()) {
        paths.push(PathBuf::from(dir).join("focuspill/ai-provider.json"));
    }
    paths.push(PathBuf::from("/usr/share/focuspill/ai-provider.json"));
    paths
}

pub fn find_distro_provider() -> Option<(ProviderFile, PathBuf)> {
    discovery_paths().into_iter().find_map(|path| {
        let text = std::fs::read_to_string(&path).ok()?;
        let parsed: ProviderFile = serde_json::from_str(&text)
            .map_err(|e| eprintln!("focuspill: {} no es válido: {e}", path.display()))
            .ok()?;
        (parsed.api == "openai-chat").then_some((parsed, path))
    })
}

fn target_from_file(p: &ProviderFile) -> Target {
    let api_key = p.api_key.clone().filter(|k| !k.is_empty()).or_else(|| {
        p.api_key_file
            .as_ref()
            .and_then(|f| std::fs::read_to_string(expand_vars(f)).ok())
            .map(|k| k.trim().to_string())
    });
    let endpoint = expand_vars(&p.endpoint);
    let default_base = if endpoint.starts_with("unix://") { "/v1" } else { "" };
    Target {
        endpoint,
        base_path: p.base_path.clone().unwrap_or_else(|| default_base.into()),
        model: p.model.clone().unwrap_or_else(|| "default".into()),
        api_key,
        timeout: Duration::from_secs(p.timeout_seconds.unwrap_or(180)),
        supports_json: p.supports_json,
    }
}

fn resolve(cfg: &ClientConfig) -> Result<Target, String> {
    match cfg.provider.as_str() {
        "distro" => {
            let (file, _) = find_distro_provider().ok_or("No se encontró la IA de la distro (falta ai-provider.json)")?;
            let mut t = target_from_file(&file);
            if !cfg.model.trim().is_empty() {
                t.model = cfg.model.trim().into();
            }
            Ok(t)
        }
        "custom" => {
            let endpoint = cfg.endpoint.trim();
            if endpoint.is_empty() {
                return Err("Indica la dirección del servidor de IA".into());
            }
            let file = ProviderFile {
                endpoint: endpoint.into(),
                model: Some(if cfg.model.trim().is_empty() { "default".into() } else { cfg.model.trim().into() }),
                api_key: Some(cfg.api_key.trim().into()),
                ..Default::default()
            };
            let mut t = target_from_file(&file);
            t.supports_json = true;
            Ok(t)
        }
        _ => Err("La IA está desactivada".into()),
    }
}

fn headers(t: &Target) -> Vec<(&'static str, String)> {
    let mut h = vec![("Accept", "application/json".to_string())];
    if let Some(k) = &t.api_key {
        if !k.is_empty() {
            h.push(("Authorization", format!("Bearer {k}")));
        }
    }
    h
}

pub fn status() -> Value {
    match find_distro_provider() {
        Some((file, path)) => json!({
            "distro": DistroInfo {
                name: if file.name.is_empty() { "IA de la distro".into() } else { file.name.clone() },
                endpoint: expand_vars(&file.endpoint),
                model: file.model.clone(),
                source: path.display().to_string(),
            }
        }),
        None => json!({ "distro": null, "searched": discovery_paths().iter().map(|p| p.display().to_string()).collect::<Vec<_>>() }),
    }
}

pub fn list_models(cfg: &ClientConfig) -> Result<Vec<String>, String> {
    let t = resolve(cfg)?;
    let path = http::join(&t.base_path, "models");
    let resp = http::request("GET", &t.endpoint, &path, &headers(&t), None, Duration::from_secs(10))?;
    if resp.status >= 400 {
        return Err(format!("El servidor respondió {}", resp.status));
    }
    let v: Value = serde_json::from_str(&resp.body).map_err(|_| "Respuesta de modelos no válida".to_string())?;
    let models = v["data"]
        .as_array()
        .or_else(|| v["models"].as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().or_else(|| m["name"].as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok(models)
}

pub fn chat(cfg: &ClientConfig, messages: &Value, want_json: bool) -> Result<String, String> {
    let t = resolve(cfg)?;
    let path = http::join(&t.base_path, "chat/completions");
    let mut body = json!({
        "model": t.model,
        "messages": messages,
        "temperature": 0.3,
        "stream": false,
    });
    if want_json && t.supports_json {
        body["response_format"] = json!({ "type": "json_object" });
    }
    let mut resp = http::request("POST", &t.endpoint, &path, &headers(&t), Some(&body.to_string()), t.timeout)?;

    // Algunos servidores no aceptan response_format: reintentamos sin él.
    if resp.status == 400 && body.get("response_format").is_some() {
        body.as_object_mut().unwrap().remove("response_format");
        resp = http::request("POST", &t.endpoint, &path, &headers(&t), Some(&body.to_string()), t.timeout)?;
    }
    if resp.status >= 400 {
        let detail: String = resp.body.chars().take(240).collect();
        return Err(format!("La IA respondió {}: {detail}", resp.status));
    }
    extract_content(&resp.body)
}

pub fn extract_content(body: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "La IA devolvió una respuesta que no es JSON".to_string())?;
    v["choices"][0]["message"]["content"]
        .as_str()
        .or_else(|| v["message"]["content"].as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| "La respuesta de la IA no trae contenido".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Las pruebas que tocan variables de entorno no pueden ir en paralelo.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn reads_openai_and_ollama_shapes() {
        let openai = r#"{"choices":[{"message":{"role":"assistant","content":" hola "}}]}"#;
        assert_eq!(extract_content(openai).unwrap(), "hola");
        let ollama = r#"{"message":{"role":"assistant","content":"adiós"}}"#;
        assert_eq!(extract_content(ollama).unwrap(), "adiós");
        assert!(extract_content("{}").is_err());
    }

    #[test]
    fn expands_runtime_dir() {
        std::env::set_var("XDG_RUNTIME_DIR", "/run/user/1234");
        assert_eq!(expand_vars("unix://${XDG_RUNTIME_DIR}/ai.sock"), "unix:///run/user/1234/ai.sock");
    }

    #[test]
    fn unix_endpoint_defaults_to_v1() {
        let f = ProviderFile { endpoint: "unix:///tmp/x.sock".into(), ..Default::default() };
        assert_eq!(target_from_file(&f).base_path, "/v1");
        let h = ProviderFile { endpoint: "http://127.0.0.1:9/v1".into(), ..Default::default() };
        assert_eq!(target_from_file(&h).base_path, "");
    }

    #[test]
    fn env_override_is_searched_first() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var("FOCUSPILL_AI_PROVIDER", "/tmp/custom.json");
        assert_eq!(discovery_paths()[0], PathBuf::from("/tmp/custom.json"));
        std::env::remove_var("FOCUSPILL_AI_PROVIDER");
    }

    /// Simula la IA de una distro en un socket Unix y recorre el camino completo:
    /// descubrimiento por ai-provider.json → petición HTTP por el socket → respuesta.
    #[cfg(unix)]
    #[test]
    fn talks_to_a_distro_provider_over_a_unix_socket() {
        use std::io::{BufRead, BufReader, Read, Write};
        use std::os::unix::net::UnixListener;

        let _guard = ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("focuspill-ai-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sock = dir.join("ai.sock");
        let listener = UnixListener::bind(&sock).unwrap();

        let server = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                let mut len = 0usize;
                let mut auth = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" { break; }
                    let lower = line.to_ascii_lowercase();
                    if let Some(v) = lower.strip_prefix("content-length:") { len = v.trim().parse().unwrap(); }
                    if lower.starts_with("authorization:") { auth = line.trim().to_string(); }
                }
                let mut body = vec![0; len];
                reader.read_exact(&mut body).unwrap();
                seen.push((request_line.trim().to_string(), String::from_utf8(body).unwrap(), auth));
                let payload = if request_line.starts_with("GET") {
                    r#"{"data":[{"id":"distro-8b"}]}"#.to_string()
                } else {
                    r#"{"choices":[{"message":{"content":"hola desde la distro"}}]}"#.to_string()
                };
                // Respuesta troceada (chunked), como hacen muchos servidores.
                let resp = format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{payload}\r\n0\r\n\r\n", payload.len());
                stream.write_all(resp.as_bytes()).unwrap();
            }
            seen
        });

        let provider = dir.join("ai-provider.json");
        std::fs::write(&provider, format!(r#"{{"name":"MiDistro AI","api":"openai-chat","endpoint":"unix://{}","model":"distro-8b","api_key":"k123"}}"#, sock.display())).unwrap();
        std::env::set_var("FOCUSPILL_AI_PROVIDER", &provider);

        let status = status();
        assert_eq!(status["distro"]["name"], "MiDistro AI");
        let cfg = ClientConfig { provider: "distro".into(), endpoint: String::new(), model: String::new(), api_key: String::new() };
        assert_eq!(list_models(&cfg).unwrap(), vec!["distro-8b"]);
        let answer = chat(&cfg, &json!([{ "role": "user", "content": "hola" }]), true).unwrap();
        assert_eq!(answer, "hola desde la distro");

        let seen = server.join().unwrap();
        assert_eq!(seen[0].0, "GET /v1/models HTTP/1.1");
        assert_eq!(seen[1].0, "POST /v1/chat/completions HTTP/1.1");
        let sent: Value = serde_json::from_str(&seen[1].1).unwrap();
        assert_eq!(sent["model"], "distro-8b");
        assert_eq!(sent["response_format"]["type"], "json_object");
        assert_eq!(seen[1].2, "Authorization: Bearer k123");

        std::env::remove_var("FOCUSPILL_AI_PROVIDER");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
