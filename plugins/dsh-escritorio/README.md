# dsh-escritorio

Convierte la interfaz de tu proyecto en una **app de escritorio para Windows y Mac**, con instalador, **automatizaciones y robots que trabajan solos** y **datos en tiempo real** con Supabase. La app es independiente: no necesita Harness, DeepSeek ni navegador.

## Qué trae la app

- Ventana que recuerda su tamaño y posición, modo claro y oscuro del sistema, una sola instancia abierta.
- Ícono en la **bandeja del sistema** (seguir abierta al cerrar, "Iniciar con el sistema", "Salir").
- **Atajo de teclado global** para mostrarla u ocultarla.
- **Archivos del PC**: abrir y "Guardar como" con los diálogos del sistema, y mostrar en el Explorador o Finder.
- **Notificaciones** del sistema.
- **Actualizaciones automáticas**: busca versiones nuevas en GitHub al abrir y cada 4 horas, descarga en segundo plano y se instala al cerrar la app o con "Reiniciar y actualizar" (bandeja o la propia interfaz).
- Seguridad: la página no toca el sistema directamente, solo a través de `window.escritorio`; los enlaces externos abren en el navegador.

La interfaz puede ser tu proyecto web (React/Vite: se compila solo), una carpeta con HTML, una web ya publicada o una página inicial nueva.

## Automatizaciones y robots

La app trae un motor que sigue trabajando con la ventana cerrada (desde la bandeja). Cada automatización es un archivo en `escritorio/automatizaciones/` y se dispara:

| Disparador | Ejemplo |
|---|---|
| Horario | `{ cron: '0 18 * * 1-5' }`: lunes a viernes, 6 pm |
| Intervalo | `{ cada: '15m' }` |
| Carpeta vigilada | `{ carpeta: '~/Documents/Entrada', archivos: '*.csv\|*.xlsx' }` |
| Cambio en la base de datos | `{ tabla: 'pagos', evento: 'INSERT' }` (Supabase en tiempo real) |
| Al abrir la app / a mano / desde la interfaz | `{ alIniciar: true }` · `{ manual: true }` · `window.escritorio.automatizaciones.ejecutar(id)` |

- **Robots de navegador:** entran a plataformas web, inician sesión, llenan formularios, filtran y descargan archivos. Usan el navegador que ya tiene el PC (Edge en Windows, Chrome en Mac), así que no se descarga nada más. Pueden recordar la sesión entre ejecuciones y, si fallan, guardan una foto de la pantalla.
- **Seguras:** cada ejecución corre en un proceso aparte con tiempo máximo, así que un robot colgado nunca congela la app. Tienen reintentos con espera creciente, y si el PC estaba apagado a la hora programada corren al abrir.
- **Encadenables:** una automatización puede lanzar otra con sus datos, avisar en la interfaz, mandar notificaciones y guardar su propio estado.
- **Panel de Automatizaciones** (bandeja o menú de la app): estado, próxima ejecución, ejecutar, pausar, detener e historial con resultado, registro y fotos del robot.

Qué decirle a DeepSeek:

> Haz una automatización que de lunes a viernes a las 6 pm entre a la plataforma X, descargue el reporte de pagos de cada sede y me deje un consolidado en Documentos. Pruébala y muéstrame las pantallas del robot.

> Cuando llegue un Excel a la carpeta Entrada, valídalo, súbelo a la tabla matriculas y mueve el archivo a Procesados.

## Varios equipos con datos en tiempo real

Pensado para una app instalada en varios PCs (por ejemplo 4 sedes) que comparten la misma información al instante. Usa Supabase.

Qué decirle a DeepSeek:

> Conecta la app a Supabase (url y clave pública) con las tablas aprendices y pagos. Cada sede ve solo lo suyo y el administrador ve todo.

`escritorio_datos` hace esto:

- **Tablas con permisos por fila.** Genera `supabase/escritorio.sql` con cada tabla y sus columnas automáticas (id, quién la creó, creada, actualizada). El acceso puede ser:
  - `autenticados`: cualquiera con sesión.
  - `propietario`: cada quien sus filas.
  - `por-columna`: cada sede o área ve solo lo suyo, según su perfil.
  - `solo-lectura`: todos leen y solo el administrador escribe.
- **Perfiles de usuario.** Crea la tabla `perfiles` con rol (admin o usuario) y sede. Se llena sola al crear cada usuario, y nadie puede subirse de rol.
- **Tiempo real** activado en las tablas. El SQL se puede correr varias veces sin romper nada, y si cambias el acceso de una tabla no deja reglas viejas abiertas.
- **Aplicar el SQL:** si el PC tiene la variable `SUPABASE_ACCESS_TOKEN`, lo aplica solo. Si no, se pega en Supabase → SQL Editor.
- **En la interfaz** quedan:
  - `src/lib/datos.js`: la conexión única de la app.
  - `datos-en-vivo.js`: lecturas en vivo, copia local, cola sin internet y sesión.
  - `escritorio-ui.js`: tres componentes listos, que funcionan con React, Vue o HTML:

```html
<acceso-escritorio>   <!-- pantalla de inicio de sesión hasta que haya sesión -->
  <header> … <estado-conexion></estado-conexion> <usuario-escritorio></usuario-escritorio> </header>
  … tu app …
</acceso-escritorio>
```

```js
import { datos } from './lib/datos.js'
datos.enVivo('pagos', { orden: 'fecha' }, (filas) => pintar(filas)) // se actualiza solo en todos los PCs
await datos.guardar('pagos', fila)  // sin internet queda en cola y se sube al volver
datos.sesion.perfil()               // { rol, sede, … }
```

El indicador muestra "En línea", "Sin conexión · 3 cambios por subir" o "Reconectando…".

**Seguridad:** dentro de la app solo va la clave pública. Lo que cada quien puede ver o cambiar lo deciden los permisos en la base de datos. Nunca metas en una app instalable una cadena de conexión directa a Postgres (Neon, o la clave de la base de Supabase), porque cualquiera la saca del instalador.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `escritorio_crear` | Crea la app en `escritorio/` con nombre, ícono, bandeja y atajo. |
| `escritorio_probar` | Instala lo necesario, abre la app de verdad, verifica errores, puente, bandeja y atajo, ejecuta las automatizaciones una vez y devuelve resultados, registros, fotos de los robots y capturas en claro y oscuro. |
| `escritorio_automatizacion` | Crea una automatización (robot, horario, carpeta, tabla…) validando el disparador y el código. |
| `escritorio_datos` | Conecta Supabase para varios equipos: tablas con permisos por fila, perfiles con rol y sede, tiempo real, inicio de sesión, usuario y estado de conexión. |
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

- **Peso:** unos 130 MB por app (Electron incluye su propio navegador; los robots usan el del PC).
- **Firmas:** sin certificado, Windows muestra "Windows protegió tu PC" la primera vez (Más información → Ejecutar de todas formas) y Mac pide abrir con clic derecho → Abrir. Para quitar los avisos: certificado de Windows y cuenta de desarrollador de Apple (99 USD al año).
- **Mac sin Mac:** el instalador de Mac se compila en GitHub Actions; para probarlo hace falta un Mac.
- **Actualizaciones en Mac:** instalar solo exige firmar con un certificado de Apple. Sin firma, la app avisa de la versión nueva y abre la página de descarga; con firma se pone `"macFirmada": true` en `escritorio.config.json` y se actualiza sola como en Windows.
- **Registro:** lo que hace el actualizador queda en `actualizaciones.log`, dentro de la carpeta de datos de la app.
- **Repositorio privado:** las actualizaciones automáticas necesitan que las versiones sean descargables (repositorio público de instaladores, o actualizar a mano).

## Instalar

Harness Desktop: **solo desde la app**, en Plugins → Add plugin:

```
https://raw.githubusercontent.com/carcardenas20-sudo/dsh-plugins/main/paquetes/dsh-escritorio-0.4.0.tgz
```
