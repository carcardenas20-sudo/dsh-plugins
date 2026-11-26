# dsh-escritorio

Convierte la interfaz de tu proyecto en una **app de escritorio para Windows y Mac**, con instalador. La app es independiente: no necesita Harness, DeepSeek ni navegador.

## Qué trae la app

- Ventana que recuerda su tamaño y posición, modo claro y oscuro del sistema, una sola instancia abierta.
- Ícono en la **bandeja del sistema** (seguir abierta al cerrar, "Iniciar con el sistema", "Salir").
- **Atajo de teclado global** para mostrarla u ocultarla.
- **Archivos del PC**: abrir y "Guardar como" con los diálogos del sistema, y mostrar en el Explorador o Finder.
- **Notificaciones** del sistema.
- **Actualizaciones automáticas**: busca versiones nuevas en GitHub al abrir y cada 4 horas, descarga en segundo plano y se instala al cerrar la app o con "Reiniciar y actualizar" (bandeja o la propia interfaz).
- Seguridad: la página no toca el sistema directamente, solo a través de `window.escritorio`; los enlaces externos abren en el navegador.

La interfaz puede ser tu proyecto web (React/Vite: se compila solo), una carpeta con HTML, una web ya publicada o una página inicial nueva.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `escritorio_crear` | Crea la app en `escritorio/` con nombre, ícono, bandeja y atajo. |
| `escritorio_probar` | Instala lo necesario, abre la app de verdad, verifica errores, puente, bandeja y atajo, y devuelve capturas en claro y oscuro. |
| `escritorio_empaquetar` | Crea el instalador para tu computador (`.exe` en Windows, `.dmg` en Mac, `.AppImage` en Linux). |
| `escritorio_publicar` | Escribe el flujo de GitHub Actions que compila Windows, Mac y Linux a la vez y publica versiones. No sube nada sin tu aprobación. |

## Desde la interfaz

```js
if (window.escritorio) {
  const archivo = await window.escritorio.archivos.abrir({ filtros: [{ name: 'Excel', extensions: ['csv'] }] })
  const guardado = await window.escritorio.archivos.guardar({ nombre: 'reporte.csv', contenido: csv })
  window.escritorio.notificar('Listo', 'Reporte guardado')

  // Actualizaciones: mostrar la versión y un botón cuando la nueva esté lista
  const estado = await window.escritorio.actualizaciones.estado() // { estado, version, progreso, version_actual }
  window.escritorio.actualizaciones.alCambiar((s) => { if (s.estado === 'lista') mostrarBoton(`Actualizar a ${s.version}`) })
  // al tocar el botón: window.escritorio.actualizaciones.instalar()
}
```

## Publicar una versión

`escritorio_publicar` deja el flujo de GitHub Actions. Luego, cualquiera de estas, con un número mayor que el anterior:

- **Desde la web (también desde el celular):** Actions → Escritorio → Run workflow → versión `1.2.0`.
- **Desde Releases:** "Draft a new release" con la etiqueta `escritorio-v1.2.0` → Publish. Los instaladores se suben solos en unos minutos.
- **Con git:** `git tag escritorio-v1.2.0 && git push origin escritorio-v1.2.0`.

Compila Windows, Mac y Linux, y publica solo si los tres salen bien. Las apps instaladas la encuentran solas.

## Lo que conviene saber

- **Peso:** unos 100 MB por app (Electron incluye su propio navegador).
- **Firmas:** sin certificado, Windows muestra "Windows protegió tu PC" la primera vez (Más información → Ejecutar de todas formas) y Mac pide abrir con clic derecho → Abrir. Para quitar los avisos: certificado de Windows y cuenta de desarrollador de Apple (99 USD al año).
- **Mac sin Mac:** el instalador de Mac se compila en GitHub Actions; para probarlo hace falta un Mac.
- **Actualizaciones en Mac:** instalar solo exige firmar con un certificado de Apple. Sin firma, la app avisa de la versión nueva y abre la página de descarga; con firma se pone `"macFirmada": true` en `escritorio.config.json` y se actualiza sola como en Windows.
- **Registro:** lo que hace el actualizador queda en `actualizaciones.log`, dentro de la carpeta de datos de la app.
- **Repositorio privado:** las actualizaciones automáticas necesitan que las versiones sean descargables (repositorio público de instaladores, o actualizar a mano).

## Instalar

Harness Desktop: **solo desde la app**, en Plugins → Add plugin:

```
https://raw.githubusercontent.com/carcardenas20-sudo/dsh-plugins/main/paquetes/dsh-escritorio-0.2.0.tgz
```
