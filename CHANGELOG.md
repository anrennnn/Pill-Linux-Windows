# Cambios

## 0.3.0

### Música: la isla dinámica dentro de la píldora
- Controles multimedia por MPRIS en Linux (Spotify, VLC, navegadores…) y por controles multimedia del sistema en Windows.
- Píldora con carátula, título y ecualizador; isla expandida al pasar el ratón o al cambiar de canción, con progreso, salto y cambio de reproductor.
- Tarjeta «Ahora suena» en Foco. Ajustes para mostrarla, asomarla o fijar un reproductor.

### Productividad
- **Modos:** abren webs y apps, cambian el preset de foco y el ambiente, activan «no molestar» y empiezan el foco. Se listan las apps instaladas (.desktop en Linux, menú Inicio en Windows).
- **Hábitos y agua:** meta diaria, anillo de progreso, racha, recordatorios en horario y «+1» desde la píldora.
- **Revisión semanal con IA:** resumen, patrones, qué mejorar y prioridades del lunes programadas solas; recordatorio semanal.

### Interfaz
- La pestaña IA pasa al final, junto a Ajustes.
- Ya no aparece un *tooltip* encima de la isla al pasar el ratón.

### Calidad
- 26 tests de la interfaz y 30 de Rust, más pruebas de integración con un reproductor MPRIS real y con el lanzamiento de apps.

## 0.2.0

### IA
- La IA de tu distro se detecta sola mediante `ai-provider.json`. Contrato abierto en `docs/DISTRO-AI.md`.
- También funciona con IA local: Ollama, LM Studio, llama.cpp, Jan o cualquier servidor compatible con OpenAI, por `http://` o socket `unix://`.
- Nuevas funciones: planificar el día, cierre del día (en Notas o Notion), clasificar capturas y preguntar.
- Servidor simulado para probar la integración: `tools/mock-ai-server.py`.

### Productividad
- Calendarios ICS (Google, Outlook, Nextcloud, Proton) con repeticiones y zonas horarias. Aviso antes de cada reunión.
- Bloques de tiempo: programa una tarea a una hora y el foco empieza solo.
- Subtareas, tareas recurrentes, arrastrar para ordenar y deshacer al borrar.
- «No molestar» automático durante el foco (GNOME, KDE, XFCE, Cinnamon, MATE).
- Sonido ambiente generado: lluvia, ruido marrón o rosa, olas.
- Informe de tiempo real por aplicación y avisos de distracción.
- Integraciones: Todoist (importar y completar) y Notion (diario).

### Sistema
- Los clics atraviesan el margen transparente de la píldora.
- Selección de monitor y atajos del sistema con un clic para Wayland (GNOME, Cinnamon, XFCE).
- Copias de seguridad diarias automáticas; exportar e importar datos.
- Las acciones externas (`--plan`, `--capture`…) ya no se pierden si llegan mientras la app arranca.

### Distribución
- Versión para Windows (`.msi` y `.exe`), además de `.deb`, `.rpm` y AppImage.
- Actualizaciones automáticas firmadas.
- CI con tests en Linux y Windows; Release automática al subir una etiqueta.
- Edición de tienda opcional con licencias de Lemon Squeezy.

### Calidad
- Interfaz dividida en módulos, con 21 tests de lógica (Node) y 22 tests de Rust.
- Migración automática de los datos de la v0.1.

## 0.1.0
- Primera versión: píldora flotante, prioridades del día, Pomodoro, captura rápida, notas y progreso. Paquete `.deb`.
