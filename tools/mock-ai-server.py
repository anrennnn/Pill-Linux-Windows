#!/usr/bin/env python3
"""Servidor de IA de prueba para FocusPill.

Implementa el mismo contrato que debe ofrecer la IA de una distro
(ver docs/DISTRO-AI.md): `GET /v1/models` y `POST /v1/chat/completions`.

Uso:
    python3 tools/mock-ai-server.py --port 7777
    python3 tools/mock-ai-server.py --unix /run/user/$UID/midistro/ai.sock

No usa ningún modelo: responde con datos fijos para probar la integración.
"""

import argparse
import json
import os
import socketserver
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL = "mock-distro-1"


def reply_for(messages):
    last = messages[-1]["content"] if messages else ""
    if '"bloques"' in last:
        return json.dumps(
            {
                "resumen": "Plan de prueba generado por el servidor simulado.",
                "bloques": [
                    {"inicio": "10:00", "minutos": 50, "tarea_id": None, "titulo": "Bloque de prueba"},
                    {"inicio": "15:00", "minutos": 25, "tarea_id": None, "titulo": "Revisión"},
                ],
                "consejo": "Esto es una respuesta simulada.",
            },
            ensure_ascii=False,
        )
    if '"logros"' in last:
        return json.dumps(
            {"resumen": "Cierre simulado.", "logros": ["Probar la integración"], "aprender": "Nada", "mañana": ["Conectar el modelo real"]},
            ensure_ascii=False,
        )
    if '"tipo"' in last:
        return json.dumps({"tipo": "tarea", "lista": "bandeja", "texto": "Captura clasificada"}, ensure_ascii=False)
    return "Hola desde la IA simulada de la distro."


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def address_string(self):  # en sockets Unix no hay dirección de cliente
        return "local"

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") == "/v1/models":
            return self._send(200, {"object": "list", "data": [{"id": MODEL, "object": "model"}]})
        self._send(404, {"error": {"message": "no encontrado"}})

    def do_POST(self):
        if self.path.rstrip("/") != "/v1/chat/completions":
            return self._send(404, {"error": {"message": "no encontrado"}})
        length = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(length) or b"{}")
        content = reply_for(req.get("messages", []))
        self._send(
            200,
            {
                "id": "chatcmpl-mock",
                "object": "chat.completion",
                "model": req.get("model", MODEL),
                "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
            },
        )


class UnixHTTPServer(socketserver.UnixStreamServer):
    def get_request(self):
        request, _ = super().get_request()
        return request, ("local", 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=7777)
    parser.add_argument("--unix", help="ruta de un socket Unix en lugar de TCP")
    args = parser.parse_args()

    if args.unix:
        os.makedirs(os.path.dirname(args.unix), exist_ok=True)
        if os.path.exists(args.unix):
            os.unlink(args.unix)
        server = UnixHTTPServer(args.unix, Handler)
        os.chmod(args.unix, 0o600)
        print(f"IA simulada escuchando en unix://{args.unix}")
    else:
        server = HTTPServer(("127.0.0.1", args.port), Handler)
        print(f"IA simulada escuchando en http://127.0.0.1:{args.port}/v1")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
