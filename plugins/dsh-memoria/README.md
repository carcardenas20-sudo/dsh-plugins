# dsh-memoria

Memoria de proyecto para DeepSeek Harness. El agente recuerda el proyecto entre conversaciones: qué es, qué se decidió y por qué, las reglas, en qué va y qué falta, y puede buscar cualquier detalle de lo que se hizo antes.

## Cómo funciona

Todo vive como archivos de texto dentro del proyecto (puedes leerlos y editarlos):

1. **Bitácora detallada** (`.dsh-memoria/bitacora/AAAA-MM.md`). Al cerrar cada turno se anota sola, sin gastar tokens: lo que pediste, lo que respondió el agente, los archivos que tocó y los comandos que corrió (con sus errores).
2. **Memoria viva** (un bloque dentro de `AGENTS.md`). Harness lee `AGENTS.md` al abrir cada conversación, así que el agente arranca sabiendo todo. Siete secciones: qué es el proyecto, stack y estructura, decisiones, reglas y preferencias, estado actual, pendientes y datos importantes. Cada dato lleva fecha e **importancia** (★1 a ★5).
3. **Resumen por tandas.** Los turnos con trabajo quedan pendientes y DeepSeek-V4.1-Flash los resume juntos cada 5 (o antes si lo pendiente es largo o lleva 12 horas). Si dices "recuerda…", tomas una decisión o defines una regla, se resume de inmediato. Gasta mucho menos que resumir cada turno.
4. **Recuerdo automático.** En cada mensaje tuyo, el plugin busca en la bitácora lo relacionado de conversaciones anteriores y se lo pasa al agente (máximo ~1.500 caracteres), sin que tenga que acordarse de buscar. No aparece en el chat, no repite lo mismo dos veces en una conversación y no trae lo que ya está en la conversación actual.
5. **Copias de seguridad.** Antes de cada cambio a la memoria se guarda una copia (`.dsh-memoria/respaldos/`, las últimas 30). Si algo queda mal, se vuelve atrás.

Herramientas para el agente:
- `memoria_buscar`: busca cualquier detalle en toda la bitácora.
- `memoria_anotar`: guarda al instante una decisión, regla, pendiente o pendiente resuelto, con su importancia.
- `memoria_ver`: muestra la memoria, cuántos turnos esperan resumen y cuántas copias hay.
- `memoria_consolidar`: resume ya lo pendiente (por ejemplo, al cerrar una tarea grande).
- `memoria_deshacer`: vuelve a una copia anterior (`listar: true` para ver las copias).
- `memoria_importar`: recupera la memoria de un proyecto que ya venías trabajando (ver abajo).

Si la memoria se llena: primero Flash la condensa sin perder decisiones, reglas ni pendientes; si aún así pasa el tope, se quitan los datos de **menor importancia** de las secciones no críticas (siguen en la bitácora). Nunca se corta el final.

Protecciones: lo que escribas en `AGENTS.md` fuera del bloque no se toca; claves, tokens y contraseñas se ocultan antes de guardar; si Flash responde algo raro, la memoria queda como estaba.

## Instalar

```
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-memoria"
```

En Harness Desktop, desde Settings → Plugins con el mismo enlace.

Recomendado también: activa la búsqueda en conversaciones anteriores de Harness (Plugins → Add plugin → `@deepseek-ai/dsh-experimental-session-search` → Install → Enable now).

## Para un proyecto que ya llevas avanzado: no se pierde nada

Harness guarda todas tus conversaciones en `%USERPROFILE%\.dsh\sessions` (en Mac/Linux, `~/.dsh/sessions`). Después de instalar el plugin, abre una conversación en la carpeta del proyecto y dile:

> Usa memoria_importar para recuperar la memoria de este proyecto.

El plugin:
1. Lee **todas** las conversaciones anteriores que tuviste en esa carpeta (pedidos, respuestas, archivos tocados, comandos y errores) y las pasa a la bitácora.
2. Lee los documentos del proyecto: README, `AGENTS.md`/`CLAUDE.md`, `docs/`, `package.json`, esquemas y migraciones de base de datos y `.env.example` (solo los nombres de las variables).
3. Arma la memoria viva con Flash, por partes y en orden cronológico, para que lo más reciente prevalezca sobre lo viejo.

Se puede repetir sin duplicar: solo agrega lo nuevo. Con `reconstruir: true` rehace la memoria desde cero usando la bitácora ya guardada (sin volver a leer ni duplicar nada). Puede tardar unos minutos en proyectos con mucho historial.

## Consejos

- Trabaja cada proyecto en su propia carpeta: la memoria es por carpeta.
- Si algo de la memoria está mal, edítalo directo en `AGENTS.md` o dile al agente que lo corrija.
- Si el repositorio es público, considera agregar `.dsh-memoria/` a `.gitignore` (la bitácora guarda tus conversaciones).

## Configuración (opcional)

| Clave | Por defecto | Qué hace |
| --- | --- | --- |
| `consolidar` | `true` | Actualizar la memoria viva con Flash. |
| `consolidarCada` | `5` | Turnos con trabajo antes de resumir. |
| `recuerdo` | `true` | Recuerdo automático en cada mensaje. |
| `recuerdoMax` | `1500` | Caracteres máximos del recuerdo. |
| `respaldos` | `30` | Copias de seguridad que se guardan. |
| `modelo.model` | `deepseek-flash` | Modelo que actualiza la memoria. |
| `archivoMemoria` | `AGENTS.md` | Archivo donde vive el bloque de memoria. |
| `carpeta` | `.dsh-memoria` | Carpeta de la bitácora. |
| `maxMemoria` | `24000` | Tamaño objetivo de la memoria viva, en caracteres. Si lo pasa, Flash la condensa sin perder decisiones, reglas ni pendientes. |
| `limiteDuro` | `48000` | Tope absoluto. Si se alcanza, se quitan los datos más antiguos de las secciones menos críticas (siguen en la bitácora); nunca se corta el final. |
| `dshHome` | `DSH_HOME` o `~/.dsh` | Dónde busca `memoria_importar` las conversaciones guardadas. |

Probado en dsh 0.2.2: el recuerdo automático llegó al modelo en una conversación nueva sin aparecer en el chat; un turno creó un archivo, la bitácora y la memoria se escribieron solas, una conversación nueva en el mismo proyecto recibió la memoria desde el primer mensaje, y `memoria_importar` recuperó 15 turnos de 2 conversaciones guardadas por dsh.
