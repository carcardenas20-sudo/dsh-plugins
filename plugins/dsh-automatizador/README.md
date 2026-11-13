# dsh-automatizador

Automatizaciones serias en **Java 21** o **Python 3.12** dentro de DeepSeek Harness, pensadas para correr en un **servidor** (o en Windows si hace falta).

En vez de un script suelto, el agente genera un proyecto con un núcleo que ya resuelve lo aburrido y lo que suele fallar en producción:

| Qué | Cómo |
|---|---|
| Configuración | `.env` (o variables del servidor, que tienen prioridad). Si falta una variable obligatoria, la automatización falla desde el inicio con un mensaje claro. |
| Registro | `logs/AAAA-MM-DD.jsonl` por pasos, con duración. Las claves y tokens salen como `***`. |
| Reintentos | `reintentar(...)` con espera creciente (2 s, 4 s, 8 s… más un valor al azar). |
| Modo prueba | `--prueba` hace todo menos enviar o modificar sistemas externos, y registra lo que *habría* hecho. |
| Sin duplicados | `ya_hecho` / `marcar` con una clave del negocio: si se cae a la mitad, al volver a correr sigue donde iba. |
| Sin ejecuciones dobles | Candado en `datos/`. Si una ejecución quedó colgada más de 6 horas, el candado se libera. |
| Historial | `logs/ejecuciones.jsonl`: estado, pasos, error y resultado de cada ejecución. |
| Avisos | Webhook (Slack, Discord, Google Chat, Teams, n8n) o Telegram cuando falla (y, si quieres, también cuando sale bien). |
| Despliegue | `Dockerfile` con horario (supercronic) y zona horaria, `docker-compose.yml`, `fly.toml`, y `programar_windows.ps1` para el Programador de tareas. |

El núcleo de Java solo usa el JDK; el de Python, solo la librería estándar. Si la automatización necesita manejar un navegador (portales sin API), se agrega Playwright y la imagen de Docker que trae los navegadores.

## Herramientas

- **`automatizacion_crear`**: genera `automatizaciones/<nombre>/` con nombre, lenguaje, horario cron, zona horaria, si usa navegador, y las variables que necesita.
- **`automatizacion_probar`**: compila (Java: Maven; si no hay internet y no hay dependencias, usa javac) y ejecuta. Por defecto corre en **modo prueba**. Devuelve el estado, cada paso y la consola, para corregir y repetir. El modo real solo se usa si tú lo pides.
- **`automatizacion_ejecuciones`**: lista las automatizaciones y su historial (porcentaje de éxito, en qué paso falló, el error).

Además le da al agente reglas para escribirlas bien:

- La lógica va solo en `tarea.py` o `Tarea.java`.
- Cada llamada externa va con reintentos.
- Nada se envía en modo prueba.
- Se usan claves para no duplicar trabajo.
- Los secretos van en `.env`.
- Se prefiere usar APIs antes que manejar la pantalla. En portales, primero se explora la página y se usan selectores estables.
- Se prueba hasta que salga bien.
- Nada se despliega sin tu aprobación.

## Instalar

Harness Desktop: **solo desde la app**, en Plugins → Add plugin:

```
github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-automatizador
```

Perfil web: `dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-automatizador"`

## Ejemplo de pedido

> Hazme una automatización en Java que todos los días hábiles a las 6:30 a. m. descargue las ventas del día anterior del portal X, las guarde en un Excel y me avise por Telegram si algo falla.

El agente crea el proyecto, escribe la lógica, la prueba en modo prueba hasta que sale bien y te explica cómo llenar el `.env` y cómo dejarla corriendo (`docker compose up -d` en un servidor, `fly deploy`, o `programar_windows.ps1`).

## Configuración opcional (cordis)

| Opción | Por defecto | Para qué |
|---|---|---|
| `carpeta` | `automatizaciones` | Dónde se crean dentro del proyecto. |
| `minutosPrueba` | `10` | Tiempo máximo de una ejecución de prueba. |
| `versionPlaywright` | `1.49.0` | Versión de Playwright y de su imagen de Docker. |
| `supercronic` | `v0.2.33` | Versión de supercronic, que ejecuta el horario dentro del contenedor. |
