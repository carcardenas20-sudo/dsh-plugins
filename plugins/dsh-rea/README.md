# dsh-rea

Ingeniería inversa con [REA (Reverse Engineer Anything)](https://github.com/morluto/rea) dentro de DeepSeek Harness, sin el costo de cargar sus 229 herramientas.

Si conectas REA como servidor MCP normal, dsh le manda al modelo unos 70.000 tokens de descripciones en **cada** llamada, y con más de 260 herramientas el modelo se confunde. Este plugin deja solo tres:

| Herramienta | Qué hace |
| --- | --- |
| `rea_buscar` | Encuentra las herramientas de REA que sirven para la tarea y muestra sus argumentos. Entiende español ("descompilar función", "red de una página web"). |
| `rea_llamar` | Ejecuta una herramienta de REA por nombre y devuelve la evidencia. |
| `rea_guia` | El método de trabajo oficial de REA y sus referencias (JavaScript, Android, observación en ejecución…). |

REA arranca solo la primera vez que el agente lo usa y se cierra con dsh. Si no lo usas, no gasta nada.

## Instalar

1. Node.js: REA pide 22.23.4+, 24.22.1+ o 26.12.1+. Revisa con `node --version`.
2. Instala REA:
   ```
   npm install -g rea-agents
   ```
3. Instala el plugin:
   ```
   dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-rea"
   ```
   En Harness Desktop, desde Settings → Plugins con el mismo enlace.

Si ya conectaste REA como MCP en la configuración (`mcp-rea`), quita esa entrada: con este plugin sobra.

## Usar

Pídele al agente, por ejemplo:

> Usa REA para entender cómo funciona la búsqueda en esta app (C:\Users\...\app.asar) y hazme algo parecido para mi proyecto.

Para análisis de binarios nativos REA necesita un motor (Ghidra, Hopper, IDA o Kuna); el análisis de apps JavaScript/Electron y de páginas web no necesita nada más. `rea_guia` explica cómo configurarlos.

Úsalo solo con software propio o que tengas permiso de analizar.

## Configuración (opcional)

| Clave | Por defecto | Qué hace |
| --- | --- | --- |
| `script` | se busca solo | Ruta a `rea-agents/scripts/rea.mjs` si no lo encuentra. |
| `comando` / `args` | Node de dsh + `rea.mjs mcp` | Otro ejecutable para REA. |
| `usarNpx` | `true` | Si REA no está instalado, usar `npx -y rea-agents@6.8.0 mcp`. |
| `timeoutSegundos` | `600` | Tiempo máximo por llamada a REA. |
| `maxCaracteres` | `40000` | Recorta resultados más largos (pide `"detail": "summary"` para los grandes). |
| `maxResultados` | `6` | Herramientas que devuelve `rea_buscar`. |
| `env` | `{}` | Variables extra para REA (por ejemplo `REA_ANALYSIS_PROVIDER`). |

Probado en dsh 0.2.2 con REA 6.8.0: búsqueda, llamada real a `analyze_javascript_application` sobre una app Electron, y el modelo recibe 35 herramientas en vez de 264.
