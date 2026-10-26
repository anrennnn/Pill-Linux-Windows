//! Servicios externos: calendarios ICS, Todoist, Notion y licencias.
//! Las llamadas viven en Rust para evitar las restricciones CORS del WebView.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::http;

const TIMEOUT: Duration = Duration::from_secs(20);

fn check(resp: http::Response, what: &str) -> Result<String, String> {
    match resp.status {
        200..=299 => Ok(resp.body),
        401 | 403 => Err(format!("{what}: credenciales no válidas")),
        404 => Err(format!("{what}: no encontrado")),
        s => Err(format!("{what} respondió {s}")),
    }
}

/* ---------------- Calendarios ICS ---------------- */

/// Descarga un calendario .ics (URL http/https, webcal:// o archivo local).
pub fn fetch_calendar(url: &str) -> Result<String, String> {
    let url = url.trim();
    if let Some(path) = url.strip_prefix("file://").or_else(|| url.starts_with('/').then_some(url)) {
        return std::fs::read_to_string(path).map_err(|e| format!("No se pudo leer {path}: {e}"));
    }
    let url = match url.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    };
    let resp = http::request("GET", &url, "", &[("Accept", "text/calendar".into())], None, TIMEOUT)?;
    let body = check(resp, "El calendario")?;
    if !body.contains("BEGIN:VCALENDAR") {
        return Err("Esa dirección no devuelve un calendario .ics".into());
    }
    Ok(body)
}

/* ---------------- Todoist (API v1) ---------------- */

const TODOIST: &str = "https://api.todoist.com/api/v1";

#[derive(Serialize)]
pub struct RemoteTask {
    pub id: String,
    pub text: String,
}

pub fn todoist_today(token: &str) -> Result<Vec<RemoteTask>, String> {
    let auth = [("Authorization", format!("Bearer {}", token.trim()))];
    let resp = http::request("GET", TODOIST, "tasks/filter?query=today%20%7C%20overdue&limit=100", &auth, None, TIMEOUT)?;
    let body = check(resp, "Todoist")?;
    let v: Value = serde_json::from_str(&body).map_err(|_| "Respuesta de Todoist no válida".to_string())?;
    let items = v["results"].as_array().or_else(|| v.as_array()).cloned().unwrap_or_default();
    Ok(items
        .iter()
        .filter_map(|t| {
            Some(RemoteTask {
                id: t["id"].as_str().map(String::from).or_else(|| t["id"].as_i64().map(|n| n.to_string()))?,
                text: t["content"].as_str()?.to_string(),
            })
        })
        .collect())
}

pub fn todoist_close(token: &str, id: &str) -> Result<(), String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Identificador de Todoist no válido".into());
    }
    let auth = [("Authorization", format!("Bearer {}", token.trim()))];
    let resp = http::request("POST", TODOIST, &format!("tasks/{id}/close"), &auth, Some("{}"), TIMEOUT)?;
    check(resp, "Todoist").map(|_| ())
}

/* ---------------- Notion ---------------- */

/// Extrae el id de una página a partir de su URL o del id con o sin guiones.
pub fn notion_page_id(input: &str) -> Option<String> {
    let tail = input.trim().split(['?', '#']).next()?.rsplit(['/', '-']).next()?;
    let hex: String = tail.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    let candidate = if hex.len() >= 32 { hex[hex.len() - 32..].to_string() } else {
        let all: String = input.chars().filter(|c| c.is_ascii_hexdigit()).collect();
        if all.len() < 32 { return None; }
        all[all.len() - 32..].to_string()
    };
    Some(candidate.to_lowercase())
}

pub fn notion_append(token: &str, page: &str, title: &str, text: &str) -> Result<(), String> {
    let page_id = notion_page_id(page).ok_or("Esa no parece una página de Notion")?;
    let paragraphs: Vec<Value> = text
        .split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .map(|p| {
            let content: String = p.chars().take(1900).collect();
            json!({ "object": "block", "type": "paragraph", "paragraph": { "rich_text": [{ "type": "text", "text": { "content": content } }] } })
        })
        .collect();
    let mut children = vec![json!({
        "object": "block", "type": "heading_3",
        "heading_3": { "rich_text": [{ "type": "text", "text": { "content": title } }] }
    })];
    children.extend(paragraphs);
    let body = json!({ "children": children }).to_string();
    let headers = [
        ("Authorization", format!("Bearer {}", token.trim())),
        ("Notion-Version", "2022-06-28".into()),
    ];
    let resp = http::request("PATCH", "https://api.notion.com/v1", &format!("blocks/{page_id}/children"), &headers, Some(&body), TIMEOUT)?;
    check(resp, "Notion").map(|_| ())
}

/* ---------------- Licencias (Lemon Squeezy) ---------------- */

#[cfg(feature = "licensing")]
pub mod license {
    use super::*;

    const API: &str = "https://api.lemonsqueezy.com/v1/licenses";

    fn form(pairs: &[(&str, &str)]) -> String {
        // La API acepta JSON además de formularios.
        let map: serde_json::Map<String, Value> = pairs.iter().map(|(k, v)| (k.to_string(), json!(v))).collect();
        Value::Object(map).to_string()
    }

    pub fn activate(key: &str, instance: &str) -> Result<String, String> {
        let resp = http::request("POST", API, "activate", &[("Accept", "application/json".into())], Some(&form(&[("license_key", key.trim()), ("instance_name", instance)])), TIMEOUT)?;
        let v: Value = serde_json::from_str(&resp.body).map_err(|_| "Respuesta de licencias no válida".to_string())?;
        if v["activated"].as_bool() == Some(true) {
            v["instance"]["id"].as_str().map(String::from).ok_or("Falta el id de activación".into())
        } else {
            Err(v["error"].as_str().unwrap_or("No se pudo activar la licencia").to_string())
        }
    }

    pub fn validate(key: &str, instance_id: &str) -> Result<bool, String> {
        let resp = http::request("POST", API, "validate", &[("Accept", "application/json".into())], Some(&form(&[("license_key", key.trim()), ("instance_id", instance_id)])), TIMEOUT)?;
        let v: Value = serde_json::from_str(&resp.body).map_err(|_| "Respuesta de licencias no válida".to_string())?;
        Ok(v["valid"].as_bool().unwrap_or(false))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_notion_ids() {
        let id = "1f2e3d4c5b6a79881f2e3d4c5b6a7988";
        assert_eq!(notion_page_id(&format!("https://www.notion.so/miespacio/Diario-{id}?pvs=4")).as_deref(), Some(id));
        assert_eq!(notion_page_id("1f2e3d4c-5b6a-7988-1f2e-3d4c5b6a7988").as_deref(), Some(id));
        assert_eq!(notion_page_id("no es un id"), None);
    }

    #[test]
    fn reads_local_calendars() {
        let path = std::env::temp_dir().join(format!("fp-{}.ics", std::process::id()));
        std::fs::write(&path, "BEGIN:VCALENDAR\nEND:VCALENDAR").unwrap();
        assert!(fetch_calendar(path.to_str().unwrap()).unwrap().contains("VCALENDAR"));
        std::fs::remove_file(path).unwrap();
    }
}
