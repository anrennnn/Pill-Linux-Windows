# FocusPill

Píldora flotante de productividad para Linux. Vive arriba en el centro de la pantalla, en todos tus escritorios virtuales, y te muestra en qué estás trabajando y cuánto te queda de foco.

Inspirada en Orby (orby.win), pero centrada solo en productividad: menos herramientas y mejor hechas.

![Píldora y captura rápida](docs/pildora.png)

![Panel: Hoy, Foco y Notas](docs/panel.png)

**Descarga:** [`releases/FocusPill_0.1.0_amd64.deb`](releases/FocusPill_0.1.0_amd64.deb) (Linux, 2,1 MB).

## Qué hace

| Modo | Cómo se abre | Para qué |
|---|---|---|
| **Píldora** | Siempre visible | Tarea actual, temporizador, progreso y botón ▶/‖ |
| **Captura** | `Ctrl+Alt+Espacio` o clic derecho en la píldora | Apuntar algo sin salir de lo que haces |
| **Panel** | Clic en la píldora o `Ctrl+Alt+P` | Hoy, Foco, Notas, Progreso y Ajustes |

- **Hoy:** un máximo de 3 prioridades, más una bandeja para todo lo demás. Edita con doble clic y ▶ empieza el foco en esa tarea.
- **Foco:** Pomodoro ligado a una tarea, con descansos cortos y largos, presets (25/5, 50/10, 90/15, 15/3), notificación y sonido.
- **Captura rápida:**
  - `!texto` → Hoy
  - `n: texto` → Nota
  - cualquier otro texto → Bandeja
- **Notas:** apuntes rápidos que se pueden convertir en tarea.
- **Progreso:** foco de hoy, bloques, tareas hechas, racha de días, gráfico de 7 días y en qué tareas se fue tu tiempo.
- **Ajustes:**
  - Tema oscuro, claro o del sistema, y 8 colores de acento.
  - Duraciones del Pomodoro y meta diaria.
  - Inicio con la sesión.

Los datos se guardan en local, en `~/.local/share/com.focuspill.app/`.

## Instalar

```bash
sudo apt install ./releases/FocusPill_0.1.0_amd64.deb
```

Funciona en Ubuntu 22.04 o posterior, Debian 12 o posterior, Linux Mint 21 o posterior, Pop!_OS y elementary, en cualquier distro con `libwebkit2gtk-4.1-0`. Apt instala las dependencias solo.

## Escritorios

- **Todos los escritorios virtuales:** la ventana es *sticky*, siempre encima y no aparece en la barra de tareas ni en Alt+Tab.
- **GNOME, KDE Plasma, XFCE, Cinnamon, MATE y Budgie:** la ventana usa las propiedades estándar EWMH (`_NET_WM_STATE_ABOVE`, `_NET_WM_DESKTOP = todos`), que respetan todos ellos. Verificado en X11 con Openbox; queda pendiente probarlo en cada escritorio real.
- **Wayland:** la app arranca por XWayland de forma automática, porque Wayland no permite a las apps fijar su posición ni quedarse encima. Si quieres probar Wayland nativo: `FOCUSPILL_NATIVE_WAYLAND=1 focuspill`.
- **Atajos en Wayland:** los atajos globales solo llegan cuando una ventana X11 tiene el foco. Para que funcionen siempre, crea atajos en la configuración de teclado de tu escritorio con estos comandos:
  - `focuspill --capture`
  - `focuspill --toggle-focus`
  - `focuspill --open`
- **Bandeja del sistema:** en GNOME necesitas la extensión *AppIndicator* para ver el icono. La app funciona igual sin él.
- **Transparencia:** necesita un compositor, que tienen todos los escritorios modernos. Sin compositor se ve un rectángulo oscuro detrás de la píldora.

## Línea de comandos

```bash
focuspill                 # arranca (si ya está abierta, abre el panel)
focuspill --capture       # captura rápida
focuspill --toggle-focus  # iniciar / pausar foco
focuspill --open          # abrir panel
```

Estas acciones también aparecen al hacer clic derecho en el icono del menú de aplicaciones.

## Compilar

Requisitos: Rust estable, Node 20 o posterior, y en Debian o Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev build-essential
npm install
npm run build            # → src-tauri/target/release/bundle/deb/
npm run dev              # modo desarrollo
```

Para previsualizar la interfaz en el navegador, abre `ui/index.html?mode=panel&tab=focus`. Sin Tauri usa `localStorage`.

## Estructura

```
ui/            interfaz (HTML + CSS + JS, sin dependencias)
src-tauri/     backend Rust: ventana, posición, bandeja, atajos, notificaciones, autoarranque
assets/        icono fuente
```
