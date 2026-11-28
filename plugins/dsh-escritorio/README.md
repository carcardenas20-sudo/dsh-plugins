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

## Varios equipos, usuarios y roles

Pensado para una app instalada en varios PCs (por ejemplo 4 sedes) que comparten la información al instante, con usuarios y permisos. Usa Supabase.

Qué decirle a DeepSeek:

> Conecta la app a Supabase con las tablas aprendices y pagos. Roles: cajero (ve y registra pagos de su sede, puede correr la descarga de pagos) y gerente (ve todo y administra usuarios). Pon la pantalla de usuarios para el admin.

**Lo que queda listo**

- **Roles con permisos por tabla.** Para cada tabla se elige qué puede hacer el rol (ver, crear, cambiar, borrar) y sobre qué: todo, solo su sede o solo lo suyo. El rol `admin` siempre existe y lo puede todo.
- **Los permisos son datos, no código.** El administrador los cambia desde la app y aplican al instante en todos los equipos. La base de datos los hace cumplir, no solo la pantalla.
- **Usuarios creados dentro de la app** con `<admin-usuarios>`:
  - crear con rol y sede, cambiar rol o sede, desactivar (bloquea el inicio de sesión), clave nueva y borrar;
  - pestaña de roles y permisos, y pestaña de actividad con las automatizaciones de todos los equipos.
  - Funciona con una función del servidor (`supabase/functions/gestionar-usuarios`), así la clave secreta nunca va en el instalador.
- **Reglas de seguridad.** Quien gestiona usuarios no puede nombrar administradores, ni cambiarse su propio rol, ni tocar a un admin.
- **Automatizaciones por rol.** Cada rol tiene la lista de las que puede ejecutar, y las demás ni se muestran. Sin sesión iniciada no corre nada.
- **Varios equipos sin duplicar.** Una tarea programada o una reacción a cambios de tabla corre en **un solo** equipo por turno, aunque la app esté abierta en los 4.
  - `unaVez: false` la hace correr en cada equipo (por ejemplo respaldos locales).
  - `correEn: { sede: 'Norte' }` la fija a ciertos equipos.
- **Registro de corridas.** Cada corrida queda en la base con el equipo donde pasó.
- **Inicio de sesión, usuario y estado de conexión** listos: `<acceso-escritorio>`, `<usuario-escritorio>` y `<estado-conexion>`.

```js
import { datos } from './lib/datos.js'
datos.enVivo('pagos', { orden: 'fecha' }, (filas) => pintar(filas)) // se actualiza solo en todos los PCs
await datos.guardar('pagos', fila)                                  // sin internet queda en cola
datos.sesion.puede('pagos', 'borrar')                               // para mostrar u ocultar botones
```

**Puesta en marcha (una vez)**

1. Si el PC tiene `SUPABASE_ACCESS_TOKEN`, el plugin aplica solo el SQL y la función. Si no, pégalos en el SQL Editor y en Edge Functions.
2. Crea tu usuario en Supabase → Authentication y hazte admin con la línea del final del SQL.
3. Entra a la app: desde **Usuarios** creas a todos los demás.

## Página de descargas del cliente (con aviso de actualización)

Cada app tiene su página web de descargas, en el dominio del cliente (por ejemplo `descargas.textilesx.com`) o en cualquier hosting (Netlify, Cloudflare Pages, Hostinger…). El cliente no necesita GitHub ni repositorio.

Qué decirle a DeepSeek:

> La página de descargas de esta app será https://descargas.textilesx.com/. Que la app avise cuando haya versión nueva.

`escritorio_sitio` configura la app. Así funciona con el cliente:

1. **La app consulta esa dirección** al abrir y cada 4 horas.
2. **Si hay versión nueva, avisa:** muestra la notificación "Hay una versión nueva: 1.1.0", un aviso dentro de la app y un botón **Descargar**. El botón abre la página. No descarga ni instala nada por su cuenta.
3. **El usuario descarga desde la página** e instala encima. Conserva sus datos.

**Cada vez que actualizas:**

1. `escritorio_empaquetar { version: "1.1.0", notas: "Qué cambió" }` arma la carpeta `escritorio/sitio/`, con la página, `version.json`, el instalador de esta versión y `latest*.yml`.
2. Subes el contenido de esa carpeta al hosting del cliente, reemplazando lo anterior. En Netlify basta con arrastrar la carpeta. En cPanel o Hostinger se usa el administrador de archivos.

**Si quieres Windows y Mac a la vez sin tener un Mac:** usa `escritorio_publicar`. GitHub Actions compila los tres sistemas y deja el sitio listo como artefacto `sitio-de-descargas`. Si el repo tiene los secretos `NETLIFY_AUTH_TOKEN` y `NETLIFY_SITE_ID`, lo sube solo. Tu repositorio puede ser privado, porque el cliente solo ve su página.

**Detalles:**
- La página es editable (`escritorio/descargas/index.html`), con el color de la marca. Detecta Windows, Mac o Linux y muestra las novedades de la versión.
- Se puede elegir `modo: "automatica"` para que descargue e instale sola al cerrar.
- La dirección queda dentro del instalador, así que hay que configurarla **antes** de entregar la primera versión.

## Robustez para clientes reales

- **Versión mínima obligatoria.** Cuando cambias la base de datos, fijas "desde la 1.3.0" en la pestaña Sistema o con `escritorio_empaquetar { minima }`. Los equipos con una versión menor muestran "Hay que actualizar" con el botón a la página de descargas, y la base rechaza sus cambios.
- **Migraciones con historial.** Cada cambio de tablas queda como `supabase/migraciones/NNN_*.sql`: se aplica una sola vez y queda registrado. Renombrar o quitar columnas y tablas se hace con `cambios`: no se pierden datos al renombrar, y lo que se quita queda copiado en una tabla `respaldo_*`. `supabase/aplicar-todo.sql` se puede pegar entero cuantas veces sea.
- **Errores de todos los equipos.** Los fallos de la app, de la interfaz y de las automatizaciones llegan a la pestaña **Sistema**, con equipo, versión y usuario. Si no hay internet o sesión, esperan en cola.
- **Historial de cambios.** Queda registrado quién creó, cambió o borró cada registro, cuándo, desde qué equipo y qué valor tenía antes.
- **Copia de seguridad diaria.** El equipo del administrador guarda todas las tablas cada día a las 8 pm (JSON y CSV, últimas 30 copias). Si el PC estaba apagado, la hace al abrirlo.
- **Conflictos.** Si dos equipos editan el mismo registro, no se pisan. El indicador muestra "⚠ 1 conflicto" y el usuario elige qué versión queda.
- **Claves de los robots en cada equipo.** Se guardan cifradas con el llavero de Windows o Mac desde el panel (Datos privados), nunca en el instalador. En el código se leen con `await secreto('clave')`.

Probado en un proyecto real de Supabase:
- inicio de sesión real;
- la función del servidor creando un usuario y rechazando a quien no tiene permiso;
- permisos por sede y rol;
- la versión mínima rechazando a una app vieja por sus cabeceras;
- la auditoría registrando el equipo.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `escritorio_crear` | Crea la app en `escritorio/` con nombre, ícono, bandeja y atajo. |
| `escritorio_probar` | Instala lo necesario, abre la app de verdad, verifica errores, puente, bandeja y atajo, ejecuta las automatizaciones una vez y devuelve resultados, registros, fotos de los robots y capturas en claro y oscuro. |
| `escritorio_automatizacion` | Crea una automatización (robot, horario, carpeta, tabla…) validando el disparador y el código. |
| `escritorio_datos` | Conecta Supabase para varios equipos: tablas, roles con permisos por tabla y por automatización, usuarios creados desde la app, tiempo real, inicio de sesión y estado de conexión. |
| `escritorio_sitio` | Página de descargas en el dominio o hosting del cliente; la app avisa cuando hay versión nueva y abre la página. |
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
https://raw.githubusercontent.com/carcardenas20-sudo/dsh-plugins/main/paquetes/dsh-escritorio-0.7.0.tgz
```
