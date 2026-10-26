# FocusPill

Píldora flotante de productividad para **Linux y Windows**. Vive arriba en el centro de la pantalla, en todos tus escritorios virtuales, y te dice en qué estás trabajando, cuánto te queda de foco y qué viene en tu agenda.

Su IA es la de **tu distro** o un **modelo local** que elijas tú: ningún dato sale de tu equipo salvo hacia los servicios que conectes.

![Píldora y captura rápida](docs/pildora.png)

![Panel: Hoy, Foco e IA](docs/panel.png)

![Progreso y ajustes de IA](docs/progreso-ajustes.png)

## Qué hace

| Modo | Cómo se abre | Para qué |
|---|---|---|
| **Píldora** | Siempre visible | Tarea actual, temporizador, próxima reunión y botón ▶/‖ |
| **Captura** | `Ctrl+Alt+Espacio` o clic derecho en la píldora | Apuntar algo sin salir de lo que haces |
| **Panel** | Clic en la píldora o `Ctrl+Alt+P` | Hoy, Foco, Notas, IA, Progreso y Ajustes |

**Hoy**
- Agenda del día con tus calendarios (Google, Outlook, Nextcloud, Proton…) y tus bloques de tiempo.
- Un máximo de 3 prioridades, más bandeja y tareas programadas.
- Subtareas, tareas que se repiten (diaria, laborables, semanal o mensual), arrastrar para ordenar y deshacer al borrar.
- Programar una tarea a una hora: al llegar, el foco empieza solo.
- Importar de Todoist; al completar una tarea en FocusPill, también se completa allí.

**Foco**
- Pomodoro ligado a una tarea, con descansos cortos y largos y presets (25/5, 50/10, 90/15, 15/3).
- «No molestar» automático en GNOME, KDE, XFCE, Cinnamon y MATE.
- Sonido ambiente generado (lluvia, ruido marrón o rosa, olas).
- Aviso si te distraes: si pasas demasiado tiempo en Discord, Steam o similares durante el foco, la píldora te lo recuerda.

**IA** (de tu distro o local)
- **Planificar mi día:** propone bloques de foco alrededor de tus reuniones y los añade a tu agenda.
- **Cierre del día:** resumen de lo hecho, lo pendiente y qué mejorar. Se puede guardar en Notas o enviar a Notion.
- **Clasificar capturas:** decide si lo que apuntas es una tarea, una nota o algo para hoy.
- **Preguntar:** dudas sobre tu día con el contexto de tus tareas.

**Progreso**
- Foco de hoy, bloques completados, racha y gráfico de 7 días.
- **Tiempo real por aplicación:** productivo, neutro o distracción. Se cambia la categoría con un clic. Solo se registra el nombre de la app, nunca títulos ni contenido.

**Ajustes**
- Tema y color de acento.
- Monitor de la píldora.
- Atajos del sistema con un clic (GNOME, Cinnamon, XFCE).
- Exportar e importar datos, y copias diarias automáticas.
- Actualizaciones automáticas.

## Instalar

Descarga la última versión desde **[Releases](https://github.com/anrennnn/pill-linux-windows/releases)**:

| Sistema | Archivo |
|---|---|
| Ubuntu, Debian, Mint, Pop!_OS, elementary | `.deb` → `sudo apt install ./FocusPill_*.deb` |
| Fedora, openSUSE | `.rpm` → `sudo dnf install ./FocusPill-*.rpm` |
| Cualquier distro | `.AppImage` → `chmod +x FocusPill_*.AppImage && ./FocusPill_*.AppImage` |
| Windows 10/11 | `.msi` o `-setup.exe` |

**Descarga directa de la v0.2.0** (mismos archivos que la Release):

- Linux: [FocusPill_0.2.0_amd64.deb](https://github.com/anrennnn/pill-linux-windows/raw/main/releases/FocusPill_0.2.0_amd64.deb) · [FocusPill-0.2.0-1.x86_64.rpm](https://github.com/anrennnn/pill-linux-windows/raw/main/releases/FocusPill-0.2.0-1.x86_64.rpm)
- Windows: [FocusPill_0.2.0_x64-setup.exe](https://github.com/anrennnn/pill-linux-windows/raw/main/releases/FocusPill_0.2.0_x64-setup.exe) · [FocusPill_0.2.0_x64_es-ES.msi](https://github.com/anrennnn/pill-linux-windows/raw/main/releases/FocusPill_0.2.0_x64_es-ES.msi)

Los instaladores de Windows no están firmados con certificado: si aparece «Windows protegió su PC», pulsa «Más información» → «Ejecutar de todos modos». El AppImage, por su tamaño, solo está en Releases.

## IA: de tu distro o local

En **Ajustes → IA** eliges:

- **Mi distro:** si tu distro instala `/etc/xdg/focuspill/ai-provider.json`, FocusPill la detecta y la activa sola. El contrato para desarrolladores de distros está en **[docs/DISTRO-AI.md](docs/DISTRO-AI.md)**.
- **Local o servidor:** cualquier servidor compatible con la API de OpenAI. Hay accesos directos para Ollama, LM Studio, llama.cpp y Jan, y admite `http://` y `unix://`.
- **Ninguna:** todo lo demás funciona igual.

Para probar sin un modelo: `python3 tools/mock-ai-server.py` simula una IA que cumple el contrato.

## Escritorios

- **Todos los escritorios virtuales:** la ventana está siempre encima y no aparece en la barra de tareas ni en Alt+Tab.
- **Clics:** solo la píldora los recibe; el margen transparente deja pasar los clics a lo que haya debajo.
- **Wayland:** la app usa XWayland, porque Wayland no deja a las apps fijar su posición ni quedarse encima. Para probar Wayland nativo: `FOCUSPILL_NATIVE_WAYLAND=1 focuspill`.
- **Atajos en Wayland:** usa **Ajustes → Pantalla y atajos → Crear atajos** (GNOME, Cinnamon o XFCE). En KDE se añaden a mano con los comandos de abajo.
- **Registro de apps:** funciona en X11, XWayland y Windows. Con apps nativas de Wayland no se puede saber cuál está en primer plano.
- **Bandeja del sistema:** en GNOME hace falta la extensión AppIndicator.

## Línea de comandos

```bash
focuspill                 # arranca (si ya está abierta, abre el panel)
focuspill --capture       # captura rápida
focuspill --toggle-focus  # iniciar / pausar foco
focuspill --toggle-panel  # abrir / plegar panel
focuspill --plan          # planificar el día con IA
```

## Datos y privacidad

- Todo se guarda en local: `~/.local/share/com.focuspill.app/` en Linux y `%APPDATA%\com.focuspill.app\` en Windows.
- Los archivos son privados (`0600`) porque guardan los tokens de las integraciones.
- Se hace una copia diaria automática y se conservan 14.
- Los servicios externos solo se contactan si los configuras: calendarios ICS, Todoist, Notion, licencias y actualizaciones.

## Desarrollo

Requisitos: Rust estable, Node 20 o posterior, y en Debian o Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev build-essential
npm install
npm test               # tests de la interfaz (lógica, calendario, IA)
npm run test:rust      # tests de Rust (incluye IA por socket Unix)
npm run dev            # modo desarrollo
npm run build:linux    # .deb, .rpm y AppImage
```

Para previsualizar la interfaz en el navegador, sirve `ui/` con `python3 -m http.server` y abre `index.html?mode=panel&tab=ai&plan=1`.

```
ui/js/core.js          lógica pura: fechas, Pomodoro, recurrencias, calendario ICS
ui/js/ai-prompts.js    prompts y validación de respuestas de IA
ui/js/actions.js       tareas, foco, agenda, IA e integraciones
ui/js/views/           vistas del panel
src-tauri/src/         ventana, IA, HTTP/unix, sistema, registro de apps, datos
docs/                  DISTRO-AI.md, RELEASING.md, LICENSING.md
```

Publicar una versión: ver **[docs/RELEASING.md](docs/RELEASING.md)**.
