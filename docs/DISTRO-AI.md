# Conectar la IA de una distro con FocusPill

FocusPill no lleva un modelo dentro. Usa la IA que el usuario elige:

- **La IA de su distro.** Se detecta sola si la distro declara su servicio.
- **Una IA local** como Ollama, LM Studio, llama.cpp, Jan, vLLM o LocalAI, o cualquier servidor compatible con la API de OpenAI.
- **Ninguna.** Todo lo demás funciona igual sin IA.

Este documento explica qué tiene que ofrecer una distro para que FocusPill use su IA sin que el usuario configure nada.

## Resumen

1. Tu distro ejecuta un servicio de IA local que habla el formato **Chat Completions de OpenAI**, por **socket Unix** (recomendado) o por `http://127.0.0.1`.
2. Tu distro instala el archivo **`/etc/xdg/focuspill/ai-provider.json`**, que dice dónde está ese servicio.
3. Al arrancar, FocusPill encuentra el archivo y activa la IA de la distro.

## 1. El archivo `ai-provider.json`

```json
{
  "name": "MiDistro AI",
  "api": "openai-chat",
  "endpoint": "unix://${XDG_RUNTIME_DIR}/midistro/ai.sock",
  "base_path": "/v1",
  "model": "midistro-8b",
  "api_key_file": "${XDG_RUNTIME_DIR}/midistro/ai.key",
  "timeout_seconds": 180,
  "supports_json": true
}
```

| Campo | Obligatorio | Significado |
|---|---|---|
| `name` | no | Nombre que ve el usuario («Conectado a MiDistro AI»). |
| `api` | sí | Por ahora siempre `"openai-chat"`. Reservado para versiones futuras del contrato. |
| `endpoint` | sí | `unix:///ruta/al.sock` o `http://127.0.0.1:PUERTO/v1`. |
| `base_path` | no | Prefijo de las rutas. Por defecto es `/v1` con `unix://` y vacío con `http://`, porque ahí se incluye en la propia URL. |
| `model` | no | Modelo por defecto. El usuario puede cambiarlo en Ajustes. |
| `api_key` / `api_key_file` | no | Si tu servicio exige clave, se manda como `Authorization: Bearer …`. Usa `api_key_file` para no dejar la clave en `/etc`. |
| `timeout_seconds` | no | Por defecto 180. Los modelos locales en CPU pueden tardar. |
| `supports_json` | no | `true` si aceptas `response_format: {"type":"json_object"}`. Por defecto `true`. |

Variables que FocusPill expande: `${XDG_RUNTIME_DIR}`, `${HOME}` y `${UID}`.

### Dónde se busca (en este orden)

1. La ruta de la variable de entorno `FOCUSPILL_AI_PROVIDER`, útil para desarrollar.
2. `~/.config/focuspill/ai-provider.json`, que permite al usuario sustituir la de la distro.
3. `$XDG_CONFIG_DIRS/focuspill/ai-provider.json`, normalmente **`/etc/xdg/focuspill/ai-provider.json`**. Aquí es donde la debe instalar la distro.
4. `/usr/share/focuspill/ai-provider.json`.

Se usa el primero que exista y sea válido.

## 2. La API que debe responder tu servicio

Es un subconjunto pequeño de la API de OpenAI, así que puedes usar cualquier servidor que ya la implemente (llama.cpp `llama-server`, Ollama, vLLM, LocalAI…) o escribir el tuyo.

### `GET {base}/models` (opcional, recomendado)

Sirve para el botón «Probar conexión» y para listar modelos.

```json
{ "data": [ { "id": "midistro-8b" } ] }
```

### `POST {base}/chat/completions` (obligatorio)

Petición que envía FocusPill:

```json
{
  "model": "midistro-8b",
  "messages": [
    { "role": "system", "content": "Eres el asistente de productividad de FocusPill…" },
    { "role": "user", "content": "…" }
  ],
  "temperature": 0.3,
  "stream": false,
  "response_format": { "type": "json_object" }
}
```

Respuesta mínima:

```json
{ "choices": [ { "message": { "role": "assistant", "content": "…" } } ] }
```

Detalles:

- **Sin streaming.** FocusPill siempre manda `stream: false`.
- **`response_format`:** si tu servicio no lo admite, responde **400** y FocusPill repite la petición sin ese campo.
- **HTTP/1.1** con `Content-Length` o `Transfer-Encoding: chunked`. FocusPill cierra la conexión tras cada petición.
- También se acepta el formato nativo de Ollama (`{"message":{"content":"…"}}`).
- **Errores:** cualquier estado 4xx o 5xx se muestra al usuario con las primeras líneas del cuerpo.

### Qué le pide FocusPill a la IA

| Función | Respuesta esperada |
|---|---|
| Planificar el día | JSON `{"resumen","bloques":[{"inicio":"HH:MM","minutos","tarea_id","titulo"}],"consejo"}` |
| Cierre del día | JSON `{"resumen","logros":[…],"aprender","mañana":[…]}` |
| Clasificar capturas | JSON `{"tipo":"tarea"\|"nota","lista":"hoy"\|"bandeja","texto"}` |
| Preguntar | Texto libre |

FocusPill valida todo lo que recibe: descarta horas imposibles e ids de tareas inventados, y extrae el JSON aunque venga envuelto en texto o en un bloque de código. Aun así, un modelo de 7–8B ajustado a instrucciones da mejores resultados que uno de 1–3B.

## 3. Seguridad recomendada

- **Usa un socket Unix** dentro de `$XDG_RUNTIME_DIR` con permisos `0600`. Así solo el usuario de la sesión puede usar su IA, sin puertos abiertos.
- Si usas TCP, escucha **solo en `127.0.0.1`** y exige clave (`api_key_file`).
- FocusPill solo envía el texto de las tareas, la agenda del día y los minutos de foco. No envía notas, tokens de integraciones ni el historial de apps (solo totales en minutos para el cierre del día).

## 4. Ejemplo de empaquetado

Servicio de usuario con systemd que expone la IA en un socket:

```ini
# /usr/lib/systemd/user/midistro-ai.service
[Unit]
Description=IA local de MiDistro

[Service]
ExecStart=/usr/bin/midistro-ai --listen unix:%t/midistro/ai.sock --model /usr/share/midistro/models/midistro-8b.gguf
Restart=on-failure

[Install]
WantedBy=default.target
```

`%t` es `$XDG_RUNTIME_DIR`. El paquete de la distro instala también `/etc/xdg/focuspill/ai-provider.json` con `"endpoint": "unix://${XDG_RUNTIME_DIR}/midistro/ai.sock"`.

Si tu servicio se basa en `llama-server` de llama.cpp, que ya implementa esta API:

```bash
llama-server -m midistro-8b.gguf --host 127.0.0.1 --port 7777
# ai-provider.json → "endpoint": "http://127.0.0.1:7777/v1"
```

## 5. Probar sin tener la IA lista

El repositorio incluye un servidor simulado que cumple el contrato:

```bash
python3 tools/mock-ai-server.py --unix "$XDG_RUNTIME_DIR/midistro/ai.sock"
FOCUSPILL_AI_PROVIDER=examples/ai-provider.json focuspill
```

En FocusPill, abre **IA → Planificar mi día**: deberías ver el plan de prueba. El test `talks_to_a_distro_provider_over_a_unix_socket` (`cargo test`) recorre el mismo camino de forma automática.
