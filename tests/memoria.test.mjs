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
// ---- importar conversaciones anteriores (log zstd con varios frames, como lo guarda dsh) ----
{
  const zlib = await import('node:zlib')
  const { mkdir: mk, writeFile: wf } = await import('node:fs/promises')
  const home = await mkdtemp(path.join(tmpdir(), 'dshhome-'))
  const proyecto = await mkdtemp(path.join(tmpdir(), 'proy-'))
  await wf(path.join(proyecto, 'README.md'), '# Ventas XT\nSistema de ventas con Supabase. token=abcdef123456\n')
  const ev = (o) => JSON.stringify(o) + '\n'
  const frames = [
    ev({ type: 'session', version: 4, id: 'session-vieja-1', cwd: proyecto }),
    ev({ type: 'turn/start', time: Date.parse('2026-10-01T15:00:00Z'), data: { turn: 1 } }) +
    ev({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'Agrega el campo descuento a la tabla ventas' }] } }) +
    ev({ type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'aviso interno que no va' }] } }),
    ev({ type: 'assistant/message', data: { message: { content: [{ type: 'tool-call', id: 'c1', name: 'edit' }] } } }) +
    ev({ type: 'tool/call', data: { callId: 'c1', name: 'edit', arguments: '{"file_path":"db/ventas.sql"}' } }) +
    ev({ type: 'tool/call', data: { callId: 'c2', name: 'bash', arguments: '{"command":"npm test"}' } }) +
    ev({ type: 'tool/result', data: { message: { toolCallId: 'c2', isError: true, content: [{ type: 'text', text: 'falla migración' }] } } }) +
    ev({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Agregué descuento; la migración falla por un tipo.' }] } } }) +
    ev({ type: 'turn/end', time: Date.parse('2026-10-01T15:05:00Z'), data: { turn: 1 } }),
  ]
  const dir = path.join(home, 'sessions', '--proy--', 'session-vieja-1')
  await mk(dir, { recursive: true })
  await wf(path.join(dir, 'session.v4.jsonl.zstd'), Buffer.concat(frames.map((f) => zlib.zstdCompressSync(Buffer.from(f)))))
  // otra sesión de OTRA carpeta: no debe entrar
  const dir2 = path.join(home, 'sessions', '--otro--', 'session-otra')
  await mk(dir2, { recursive: true })
  await wf(path.join(dir2, 'session.v4.jsonl'), ev({ type: 'session', id: 'session-otra', cwd: '/otro/lado' }) + ev({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'NO DEBE APARECER' }] } }))

  const t3 = {}; const pedidos = []
  const llm3 = { stream: (o) => { pedidos.push(o.messages[0].content[0].text); return (async function* () { yield { type: 'text-delta', text: Object.values(SECCIONES).map((s) => `### ${s}\n- ok ${pedidos.length}`).join('\n') }; yield { type: 'finish', reason: { kind: 'stop' } } })() } }
  apply({ on() {}, tools: { register: (x) => { t3[x.name] = x } }, llm: llm3, workingDirectory: { ensure: async () => proyecto }, logger: {} }, { dshHome: home })
  const ex = { agent: { session: { id: 'session-actual' }, model: { current: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-pro' }) } }, signal: new AbortController().signal }
  const r = await t3.memoria_importar.execute({}, ex)
  assert.match(r, /Importé 1 turnos de 1 conversaciones/); assert.match(r, /2 de 2 lotes/)
  assert.match(pedidos[0], /DOCUMENTOS DEL PROYECTO[\s\S]*Ventas XT/); assert.ok(!pedidos[0].includes('abcdef123456'), 'oculta el token del README')
  assert.match(pedidos[1], /HISTORIAL[\s\S]*Agrega el campo descuento[\s\S]*edit `db\/ventas\.sql`[\s\S]*bash `npm test` → ERROR: falla migración/)
  assert.ok(!pedidos.join().includes('aviso interno') && !pedidos.join().includes('NO DEBE APARECER'))
  const bit = await readFile(path.join(proyecto, '.dsh-memoria/bitacora/2026-10.md'), 'utf8')
  assert.match(bit, /· importado/); assert.match(bit, /la migración falla por un tipo/)
  assert.match(await readFile(path.join(proyecto, 'AGENTS.md'), 'utf8'), /- ok 2/)
  const r2 = await t3.memoria_importar.execute({ documentos: false }, ex)
  assert.match(r2, /No encontré conversaciones nuevas/, 'no duplica')
}
console.log('memoria unit: OK')
