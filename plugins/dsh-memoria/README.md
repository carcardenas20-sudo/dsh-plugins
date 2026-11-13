# dsh-memoria

Memoria de proyecto para DeepSeek Harness. El agente recuerda el proyecto entre conversaciones: qué es, qué se decidió y por qué, las reglas, en qué va y qué falta, y puede buscar cualquier detalle de lo que se hizo antes.

## Cómo funciona

Tres capas, todas como archivos de texto dentro del proyecto (puedes leerlos y editarlos):

1. **Bitácora detallada** (`.dsh-memoria/bitacora/AAAA-MM.md`). Al cerrar cada turno se anota sola, sin gastar tokens: lo que pediste, lo que respondió el agente, los archivos que tocó y los comandos que corrió (con sus errores).
2. **Memoria viva** (un bloque dentro de `AGENTS.md`). Harness lee `AGENTS.md` solo al abrir cada conversación nueva, así que el agente arranca sabiendo todo. Tiene siete secciones: qué es el proyecto, stack y estructura, decisiones (con su porqué y fecha), reglas y preferencias, estado actual, pendientes y datos importantes. Cuando un turno hace trabajo real, DeepSeek-V4.1-Flash la actualiza en segundo plano (es barato y no te hace esperar).
3. **Herramientas para el agente**:
   - `memoria_buscar`: busca en toda la bitácora ("¿cómo arreglamos el login?", "¿qué archivo tenía los precios?").
   - `memoria_anotar`: guarda al instante una decisión, regla, pendiente o pendiente resuelto. Se usa cuando dices "recuerda que…".
   - `memoria_ver`: muestra la memoria viva actual.
   - `memoria_importar`: recupera la memoria de un proyecto que ya venías trabajando (ver abajo).

Protecciones:
- Lo que tú escribas en `AGENTS.md` fuera del bloque no se toca nunca.
- Claves, tokens y contraseñas se ocultan antes de guardar cualquier cosa.
- Si Flash responde algo raro o la memoria nueva sale mucho más corta que la anterior, se deja la anterior.
- Si Flash falla, la bitácora se guarda igual.

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

Se puede repetir sin duplicar: solo agrega lo nuevo. Con `reconstruir: true` rehace la memoria desde cero. Puede tardar unos minutos en proyectos con mucho historial.

## Consejos

- Trabaja cada proyecto en su propia carpeta: la memoria es por carpeta.
- Si algo de la memoria está mal, edítalo directo en `AGENTS.md` o dile al agente que lo corrija.
- Si el repositorio es público, considera agregar `.dsh-memoria/` a `.gitignore` (la bitácora guarda tus conversaciones).

## Configuración (opcional)

| Clave | Por defecto | Qué hace |
| --- | --- | --- |
| `consolidar` | `true` | Actualizar la memoria viva con Flash al cerrar turnos con trabajo. |
| `modelo.model` | `deepseek-flash` | Modelo que actualiza la memoria. |
| `archivoMemoria` | `AGENTS.md` | Archivo donde vive el bloque de memoria. |
| `carpeta` | `.dsh-memoria` | Carpeta de la bitácora. |
| `maxMemoria` | `12000` | Tamaño objetivo de la memoria viva, en caracteres. |
| `dshHome` | `DSH_HOME` o `~/.dsh` | Dónde busca `memoria_importar` las conversaciones guardadas. |

Probado en dsh 0.2.2: un turno creó un archivo, la bitácora y la memoria se escribieron solas, una conversación nueva en el mismo proyecto recibió la memoria desde el primer mensaje, y `memoria_importar` recuperó 15 turnos de 2 conversaciones guardadas por dsh.
