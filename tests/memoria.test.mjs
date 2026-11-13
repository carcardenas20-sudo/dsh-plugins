import { apply, extraerBloque, ponerBloque, anotarEnBloque, resolverEnBloque, bloqueVacio, sinSecretos, buscarEntradas, partirEntradas, limpiarRespuestaLLM, INICIO, FIN, SECCIONES } from '../plugins/dsh-memoria/index.js'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ---- funciones puras ----
assert.equal(sinSecretos('usa sk-proj-abcdefghijklmnop1234 y password=hola123'), 'usa [clave oculta] y password=[oculto]')
assert.equal(sinSecretos('postgres://admin:superclave@db.x.co/app'), 'postgres://admin:[oculto]@db.x.co/app')
assert.match(sinSecretos('ghp_abcdefghijklmnopqrstuvwxyz123456'), /\[token oculto\]/)

const conTexto = ponerBloque('# Mi proyecto\n\nReglas mías.\n', 'hola')
assert.match(conTexto, /^# Mi proyecto\n\nReglas mías\.\n\n<!-- dsh-memoria:inicio/)
assert.equal(extraerBloque(conTexto), 'hola')
const otra = ponerBloque(conTexto + '\nFinal del usuario\n', 'chao')
assert.equal(extraerBloque(otra), 'chao'); assert.match(otra, /Reglas mías[\s\S]*chao[\s\S]*Final del usuario/)

let b = anotarEnBloque('', 'decision', 'Usar Supabase porque ya lo conocemos', '2026-11-13')
assert.match(b, /### Decisiones\n- Usar Supabase porque ya lo conocemos _\(2026-11-13\)_/)
assert.ok(!/### Decisiones\n- \(sin datos/.test(b))
b = anotarEnBloque(b, 'pendiente', 'Conectar la pasarela de pagos Wompi', '2026-11-13')
b = resolverEnBloque(b, 'pasarela de pagos Wompi conectada', '2026-11-14')
assert.ok(!/### Pendientes[^#]*Wompi/.test(b), 'el pendiente se quitó'); assert.match(b, /### Estado actual[^#]*Resuelto: pasarela/)

const md = '## 2026-11-01 10:00\n\n**Pedido:** arreglar login\n\n## 2026-11-02 11:00\n\n**Pedido:** agregar tabla pedidos en supabase\n\n## 2026-11-03 12:00\n\n**Pedido:** el login falla otra vez con supabase'
const ents = partirEntradas(md); assert.equal(ents.length, 3)
assert.match(buscarEntradas(ents, 'login supabase')[0].e, /2026-11-03/)
assert.match(buscarEntradas(ents, '')[0].e, /2026-11-03/, 'sin consulta: lo más reciente primero')
assert.equal(buscarEntradas(ents, 'kubernetes').length, 0)
assert.equal(limpiarRespuestaLLM('blah sin formato'), null)
assert.match(limpiarRespuestaLLM('```markdown\nAquí va:\n### Qué es el proyecto\n- X\n```'), /^### Qué es el proyecto\n- X$/)

// ---- turno simulado ----
const cwd = await mkdtemp(path.join(tmpdir(), 'memoria-'))
await writeFile(path.join(cwd, 'AGENTS.md'), '# Proyecto tienda\n\nTexto del usuario que no se toca.\n')
const h = {}; const tools = {}; const llamadas = []
const llm = {
  stream: (o) => { llamadas.push(o); return (async function* () {
    const actual = o.messages[0].content[0].text
    assert.match(actual, /REGISTRO DEL ÚLTIMO TURNO/); assert.match(actual, /checkout\.js/)
    yield { type: 'text-delta', text: '```markdown\n' + Object.values(SECCIONES).map((s) => `### ${s}\n- ${s === 'Decisiones' ? 'Checkout en una sola página (2026-11-13)' : 'x'}`).join('\n') + '\n```' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })() },
}
apply({ on: (e, f) => { h[e] = f }, tools: { register: (t) => { tools[t.name] = t } }, llm, workingDirectory: { ensure: async () => cwd }, logger: { warn: (m) => { throw new Error('warn inesperado: ' + m) } } }, {})
const agent = { session: { id: 'session-1234567890' }, model: { current: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }) } }
await h['agent/pre-step']({ agent }, async () => ({ kind: 'enter', messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'Haz el checkout en una sola página, la clave es sk-live-abcdefghijklmnopqrstu' }] }] }))
h['agent/assistant-stream']({ agent, frame: { type: 'start', attemptId: 'a1', turn: 1, step: 1 } })
h['agent/assistant-stream']({ agent, frame: { type: 'chunk', attemptId: 'a1', chunk: { type: 'text-delta', text: 'Listo, ' } } })
h['agent/assistant-stream']({ agent, frame: { type: 'chunk', attemptId: 'a1', chunk: { type: 'text-delta', text: 'checkout unificado.' } } })
h['tools/result']({ agent, name: 'edit', arguments: { path: 'src/checkout.js' } }, { isError: false, content: [] })
h['tools/result']({ agent, name: 'bash', arguments: { command: 'npm test' } }, { isError: true, content: [{ type: 'text', text: '1 failing' }] })
await h['agent/turn-stopping']({ agent, signal: new AbortController().signal })
await new Promise((r) => setTimeout(r, 50))

const [mes] = await readdir(path.join(cwd, '.dsh-memoria/bitacora'))
const bit = await readFile(path.join(cwd, '.dsh-memoria/bitacora', mes), 'utf8')
assert.match(bit, /sesión 34567890/); assert.match(bit, /Haz el checkout en una sola página/); assert.match(bit, /edit `src\/checkout\.js`/)
assert.match(bit, /bash `npm test` → ERROR: 1 failing/); assert.match(bit, /Listo, checkout unificado\./)
assert.ok(!bit.includes('sk-live-abc'), 'la clave no se guardó')
assert.equal(llamadas.length, 1); assert.equal(llamadas[0].model, 'deepseek-flash'); assert.equal(llamadas[0].provider, 'deepseek-official')
const agents = await readFile(path.join(cwd, 'AGENTS.md'), 'utf8')
assert.match(agents, /^# Proyecto tienda\n\nTexto del usuario que no se toca\./)
assert.match(agents, /## Memoria del proyecto[\s\S]*Checkout en una sola página/)
assert.ok(agents.includes(INICIO) && agents.includes(FIN))

// turno trivial: bitácora sí, LLM no
await h['agent/pre-step']({ agent }, async () => ({ kind: 'enter', messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'gracias' }] }] }))
await h['agent/turn-stopping']({ agent, signal: new AbortController().signal })
await new Promise((r) => setTimeout(r, 30))
assert.equal(llamadas.length, 1)

// herramientas
const exec = { agent, signal: new AbortController().signal }
assert.match(await tools.memoria_anotar.execute({ tipo: 'regla', texto: 'Nunca cambiar los colores de la marca XT' }, exec), /Reglas y preferencias/)
assert.match(await tools.memoria_ver.execute({}, exec), /### Reglas y preferencias[\s\S]*Nunca cambiar los colores/)
assert.match(await tools.memoria_buscar.execute({ consulta: 'checkout' }, exec), /Haz el checkout/)
assert.match(await tools.memoria_buscar.execute({ consulta: 'colores marca' }, exec), /anotación/)
assert.match(await tools.memoria_buscar.execute({ consulta: 'kubernetes' }, exec), /Nada en la bitácora/)

// si el LLM responde basura, la memoria no se toca
const antes = await readFile(path.join(cwd, 'AGENTS.md'), 'utf8')
const h2 = {}; const avisos = []
apply({ on: (e, f) => { h2[e] = f }, tools: { register() {} }, llm: { stream: () => (async function* () { yield { type: 'text-delta', text: 'no sé' }; yield { type: 'finish', reason: { kind: 'stop' } } })() }, workingDirectory: { ensure: async () => cwd }, logger: { warn: (m) => avisos.push(m) } }, {})
await h2['agent/pre-step']({ agent }, async () => ({ kind: 'enter', messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'cambia el archivo de estilos para que el botón sea amarillo' }] }] }))
h2['tools/result']({ agent, name: 'write', arguments: { path: 'a.css' } }, { isError: false, content: [] })
await h2['agent/turn-stopping']({ agent, signal: new AbortController().signal })
await new Promise((r) => setTimeout(r, 50))
assert.equal(await readFile(path.join(cwd, 'AGENTS.md'), 'utf8'), antes); assert.match(avisos.join(), /formato esperado/)
console.log('memoria unit: OK')
