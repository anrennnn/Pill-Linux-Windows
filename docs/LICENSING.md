# Ediciones y licencias

FocusPill se compila en dos ediciones con el mismo código.

| | Comunidad (por defecto) | Tienda (`--features licensing`) |
|---|---|---|
| Funciones | Todas | Todas, al activar una licencia |
| Licencia | No hace falta | Clave de Lemon Squeezy |
| Para | Tu distro, código abierto, uso propio | Venta en web o Gumroad |

La IA de tu distro funciona siempre en la edición comunidad, que es la que debe empaquetar la distro.

## Activar la edición de tienda

```bash
npm run tauri build -- --features licensing
```

En *Ajustes* aparece un campo «Clave de licencia». FocusPill:

1. Llama a `POST https://api.lemonsqueezy.com/v1/licenses/activate` con la clave y un nombre de equipo.
2. Guarda el `instance_id` en `license.json`, con permisos privados.
3. Al arrancar, revalida en segundo plano con `/v1/licenses/validate`. Sin conexión mantiene el último resultado.

Para limitar el número de equipos, configura el límite de activaciones del producto en Lemon Squeezy (por ejemplo, 3).

## Propuesta de modelo

- **Gratis (comunidad):** píldora, tareas, foco, notas, progreso. Incluida en tu distro.
- **Pro:** IA, calendarios, integraciones e informe de apps, si vendes FocusPill fuera de tu distro.

Hoy el código no limita funciones en la edición de tienda: solo verifica la licencia. Qué funciones quedan detrás de Pro es una decisión de producto que conviene tomar antes de activar la venta.
