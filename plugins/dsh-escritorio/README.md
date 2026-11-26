# dsh-escritorio

Convierte la interfaz de tu proyecto en una **app de escritorio para Windows y Mac**, con instalador. La app es independiente: no necesita Harness, DeepSeek ni navegador.

## Qué trae la app

- Ventana que recuerda su tamaño y posición, modo claro y oscuro del sistema, una sola instancia abierta.
- Ícono en la **bandeja del sistema** (seguir abierta al cerrar, "Iniciar con el sistema", "Salir").
- **Atajo de teclado global** para mostrarla u ocultarla.
- **Archivos del PC**: abrir y "Guardar como" con los diálogos del sistema, y mostrar en el Explorador o Finder.
- **Notificaciones** del sistema.
- **Actualizaciones automáticas** desde las versiones publicadas en GitHub.
- Seguridad: la página no toca el sistema directamente, solo a través de `window.escritorio`; los enlaces externos abren en el navegador.

La interfaz puede ser tu proyecto web (React/Vite: se compila solo), una carpeta con HTML, una web ya publicada o una página inicial nueva.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `escritorio_crear` | Crea la app en `escritorio/` con nombre, ícono, bandeja y atajo. |
| `escritorio_probar` | Instala lo necesario, abre la app de verdad, verifica errores, puente, bandeja y atajo, y devuelve capturas en claro y oscuro. |
| `escritorio_empaquetar` | Crea el instalador para tu computador (`.exe` en Windows, `.dmg` en Mac). |
| `escritorio_publicar` | Escribe el flujo de GitHub Actions que compila Windows y Mac a la vez y publica versiones. No sube nada sin tu aprobación. |

## Desde la interfaz

```js
if (window.escritorio) {
  const archivo = await window.escritorio.archivos.abrir({ filtros: [{ name: 'Excel', extensions: ['csv'] }] })
  const guardado = await window.escritorio.archivos.guardar({ nombre: 'reporte.csv', contenido: csv })
  window.escritorio.notificar('Listo', 'Reporte guardado')
}
```

## Lo que conviene saber

- **Peso:** unos 100 MB por app (Electron incluye su propio navegador).
- **Firmas:** sin certificado, Windows muestra "Windows protegió tu PC" la primera vez (Más información → Ejecutar de todas formas) y Mac pide abrir con clic derecho → Abrir. Para quitar los avisos: certificado de Windows y cuenta de desarrollador de Apple (99 USD al año).
- **Mac sin Mac:** el instalador de Mac se compila en GitHub Actions; para probarlo hace falta un Mac.
- **Repositorio privado:** las actualizaciones automáticas necesitan que las versiones sean descargables (repositorio público de instaladores, o actualizar a mano).

## Instalar

Harness Desktop: **solo desde la app**, en Plugins → Add plugin:

```
https://raw.githubusercontent.com/carcardenas20-sudo/dsh-plugins/main/paquetes/dsh-escritorio-0.1.0.tgz
```
