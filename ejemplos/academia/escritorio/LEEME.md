# Academia — app de escritorio

Generada con dsh-escritorio (Electron 33.2.1).

| Comando (en esta carpeta) | Qué hace |
|---|---|
| `npm install` | Una sola vez: descarga Electron y las herramientas. |
| `npm run web` | Compila la interfaz de `..` y la copia a `app/`. |
| `npm start` | Abre la app para probarla. |
| `npm run dist:win` / `dist:mac` | Crea el instalador en `instaladores/`. |

- Ajustes (nombre, tamaño, bandeja, atajo): `escritorio.config.json`. Ícono: `build/icono.svg` → `npm run icono`.
- Desde la interfaz: `window.escritorio.archivos.abrir()`, `.guardar()`, `window.escritorio.notificar()` (solo dentro de la app; en el navegador no existe).
- Windows muestra "Windows protegió tu PC" la primera vez porque el instalador no está firmado: "Más información" → "Ejecutar de todas formas". En Mac: clic derecho → Abrir. Para quitar esos avisos hace falta firmar (certificado de Windows / cuenta de desarrollador de Apple).
