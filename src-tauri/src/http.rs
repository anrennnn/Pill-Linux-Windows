//! Cliente HTTP mínimo: `http(s)://` con ureq y `unix://` (socket Unix) a mano.
//! El socket Unix permite que un servicio de IA de la distro no abra puertos.

use std::time::Duration;

pub struct Response {
    pub status: u16,
    pub body: String,
}

const MAX_BODY: usize = 8 * 1024 * 1024;

/// `unix:///run/user/1000/ai.sock` → ruta del socket.
fn unix_socket_path(endpoint: &str) -> Option<&str> {
    endpoint.strip_prefix("unix://")
}

/// Une la base y la ruta sin duplicar barras.
pub fn join(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path.trim_start_matches('/'))
}

pub fn request(
    method: &str,
    endpoint: &str,
    path: &str,
    headers: &[(&str, String)],
    body: Option<&str>,
    timeout: Duration,
) -> Result<Response, String> {
    if let Some(sock) = unix_socket_path(endpoint) {
        return unix_request(method, sock, path, headers, body, timeout);
    }
    let url = if path.is_empty() { endpoint.to_string() } else { join(endpoint, path) };
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("La URL debe empezar por http://, https:// o unix://".into());
    }
    let agent = ureq::AgentBuilder::new().timeout(timeout).build();
    let mut req = agent.request(method, &url);
    for (k, v) in headers {
        req = req.set(k, v);
    }
    let result = match body {
        Some(b) => req.set("Content-Type", "application/json").send_string(b),
        None => req.call(),
    };
    let resp = match result {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return Err(describe_transport_error(&e.to_string())),
    };
    let status = resp.status();
    let mut text = String::new();
    use std::io::Read;
    resp.into_reader()
        .take(MAX_BODY as u64)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    Ok(Response { status, body: text })
}

fn describe_transport_error(e: &str) -> String {
    if e.contains("Connection refused") {
        "No hay ningún servicio escuchando en esa dirección".into()
    } else if e.contains("timed out") || e.contains("Timeout") {
        "El servicio tardó demasiado en responder".into()
    } else {
        e.to_string()
    }
}

#[cfg(unix)]
fn unix_request(
    method: &str,
    sock: &str,
    path: &str,
    headers: &[(&str, String)],
    body: Option<&str>,
    timeout: Duration,
) -> Result<Response, String> {
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;

    let mut stream = UnixStream::connect(sock).map_err(|e| format!("No se pudo abrir {sock}: {e}"))?;
    stream.set_read_timeout(Some(timeout)).ok();
    stream.set_write_timeout(Some(timeout)).ok();

    let path = if path.starts_with('/') { path.to_string() } else { format!("/{path}") };
    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAccept: application/json\r\n");
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    if let Some(b) = body {
        req.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", b.len()));
    }
    req.push_str("\r\n");
    if let Some(b) = body {
        req.push_str(b);
    }
    stream.write_all(req.as_bytes()).map_err(|e| e.to_string())?;

    let mut raw = Vec::new();
    stream
        .take(MAX_BODY as u64)
        .read_to_end(&mut raw)
        .map_err(|e| describe_transport_error(&e.to_string()))?;
    parse_http_response(&raw)
}

#[cfg(not(unix))]
fn unix_request(
    _method: &str,
    _sock: &str,
    _path: &str,
    _headers: &[(&str, String)],
    _body: Option<&str>,
    _timeout: Duration,
) -> Result<Response, String> {
    Err("Los sockets unix:// solo están disponibles en Linux".into())
}

/// Interpreta una respuesta HTTP/1.1 completa (con o sin `chunked`).
#[cfg(any(unix, test))]
pub fn parse_http_response(raw: &[u8]) -> Result<Response, String> {
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("Respuesta HTTP incompleta")?;
    let head = String::from_utf8_lossy(&raw[..split]);
    let mut lines = head.lines();
    let status_line = lines.next().ok_or("Respuesta HTTP vacía")?;
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or("Línea de estado HTTP no válida")?;
    let chunked = lines.any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("transfer-encoding:") && l.contains("chunked")
    });
    let body_bytes = &raw[split + 4..];
    let body = if chunked { dechunk(body_bytes)? } else { body_bytes.to_vec() };
    Ok(Response { status, body: String::from_utf8_lossy(&body).into_owned() })
}

#[cfg(any(unix, test))]
fn dechunk(mut data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let line_end = data.windows(2).position(|w| w == b"\r\n").ok_or("Fragmento HTTP no válido")?;
        let size_str = String::from_utf8_lossy(&data[..line_end]);
        let size = usize::from_str_radix(size_str.split(';').next().unwrap_or("").trim(), 16)
            .map_err(|_| "Tamaño de fragmento no válido")?;
        data = &data[line_end + 2..];
        if size == 0 {
            return Ok(out);
        }
        if data.len() < size {
            return Err("Fragmento HTTP truncado".into());
        }
        out.extend_from_slice(&data[..size]);
        data = data.get(size + 2..).unwrap_or(&[]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_response() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}";
        let r = parse_http_response(raw).unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.body, "{\"ok\":true}");
    }

    #[test]
    fn parses_chunked_response() {
        let raw = b"HTTP/1.1 201 Created\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nHola\r\n6\r\n mundo\r\n0\r\n\r\n";
        let r = parse_http_response(raw).unwrap();
        assert_eq!(r.status, 201);
        assert_eq!(r.body, "Hola mundo");
    }

    #[test]
    fn joins_paths() {
        assert_eq!(join("http://x/v1/", "/chat/completions"), "http://x/v1/chat/completions");
        assert_eq!(join("http://x/v1", "models"), "http://x/v1/models");
    }
}
