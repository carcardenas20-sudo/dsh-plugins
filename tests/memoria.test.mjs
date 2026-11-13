import { apply, elegirRecuerdos, palabrasClave, importanciaDe, recortarSeguro, extraerBloque, ponerBloque, anotarEnBloque, resolverEnBloque, bloqueVacio, sinSecretos, buscarEntradas, partirEntradas, limpiarRespuestaLLM, INICIO, FIN, SECCIONES } from '../plugins/dsh-memoria/index.js'
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
assert.match(b, /### Decisiones\n- Usar Supabase porque ya lo conocemos _\(2026-11-13 · ★4\)_/)
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
    assert.match(actual, /REGISTRO DE LOS ÚLTIMOS 1 TURNOS/); assert.match(actual, /checkout\.js/)
    yield { type: 'text-delta', text: '```markdown\n' + Object.values(SECCIONES).map((s) => `### ${s}\n- ${s === 'Decisiones' ? 'Checkout en una sola página (2026-11-13)' : 'x'}`).join('\n') + '\n```' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })() },
}
apply({ on: (e, f) => { h[e] = f }, tools: { register: (t) => { tools[t.name] = t } }, llm, workingDirectory: { ensure: async () => cwd }, logger: { warn: (m) => { throw new Error('warn inesperado: ' + m) } } }, { consolidarCada: 1 })
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
apply({ on: (e, f) => { h2[e] = f }, tools: { register() {} }, llm: { stream: () => (async function* () { yield { type: 'text-delta', text: 'no sé' }; yield { type: 'finish', reason: { kind: 'stop' } } })() }, workingDirectory: { ensure: async () => cwd }, logger: { warn: (m) => avisos.push(m) } }, { consolidarCada: 1 })
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
  assert.match(r, /Importé 1 turnos nuevos de 1 conversaciones/); assert.match(r, /2 de 2 lotes/)
  assert.match(pedidos[0], /DOCUMENTOS DEL PROYECTO[\s\S]*Ventas XT/); assert.ok(!pedidos[0].includes('abcdef123456'), 'oculta el token del README')
  assert.match(pedidos[1], /HISTORIAL[\s\S]*Agrega el campo descuento[\s\S]*edit `db\/ventas\.sql`[\s\S]*bash `npm test` → ERROR: falla migración/)
  assert.ok(!pedidos.join().includes('aviso interno') && !pedidos.join().includes('NO DEBE APARECER'))
  const bit = await readFile(path.join(proyecto, '.dsh-memoria/bitacora/2026-10.md'), 'utf8')
  assert.match(bit, /· importado/); assert.match(bit, /la migración falla por un tipo/)
  assert.match(await readFile(path.join(proyecto, 'AGENTS.md'), 'utf8'), /- ok 2/)
  const r2 = await t3.memoria_importar.execute({ documentos: false }, ex)
  assert.match(r2, /No encontré conversaciones nuevas/, 'no duplica')
}
// ---- tamaño: nunca se corta el final; se quitan datos viejos de secciones no críticas ----
{
  let big = bloqueVacio()
  for (let i = 0; i < 300; i++) big = anotarEnBloque(big, 'hecho', `dato viejo número ${i} con bastante texto para ocupar espacio en la memoria`, '2026-11-01')
  big = anotarEnBloque(big, 'pendiente', 'PENDIENTE CRÍTICO al final', '2026-11-13')
  big = anotarEnBloque(big, 'regla', 'REGLA que no se toca', '2026-11-13')
  const r = recortarSeguro(big, 8000)
  assert.ok(r.length <= 8400, `quedó en ${r.length}`)
  assert.match(r, /PENDIENTE CRÍTICO al final/); assert.match(r, /REGLA que no se toca/)
  assert.match(r, /dato viejo número 299/, 'conserva los datos más recientes'); assert.ok(!r.includes('dato viejo número 0 '))
  assert.match(r, /se quitaron \d+ datos de menor importancia por tamaño/)
}

// ---- reconstruir: usa la bitácora sin duplicarla y condensa si quedó grande ----
{
  const proyecto = await mkdtemp(path.join(tmpdir(), 'recon-'))
  const { mkdir: mk, writeFile: wf } = await import('node:fs/promises')
  await mk(path.join(proyecto, '.dsh-memoria/bitacora'), { recursive: true })
  const bitIni = '## 2026-10-02 09:00 · sesión aaaaaaaa · importado\n\n**Pedido:** segundo\n\n## 2026-10-01 09:00 · sesión bbbbbbbb · importado\n\n**Pedido:** primero\n\n'
  await wf(path.join(proyecto, '.dsh-memoria/bitacora/2026-10.md'), bitIni)
  const t5 = {}; const vistos = []
  const largo = 'x'.repeat(30000)
  const llm5 = { stream: (o) => { const tx = o.messages[0].content[0].text; vistos.push(tx); const compactando = tx.includes('INSTRUCCIÓN ESPECIAL')
    return (async function* () { yield { type: 'text-delta', text: Object.values(SECCIONES).map((s) => `### ${s}\n- ${compactando ? 'corto ' + 'y'.repeat(1000) : (s === 'Datos importantes' ? largo : 'ok')}`).join('\n') }; yield { type: 'finish', reason: { kind: 'stop' } } })() } }
  apply({ on() {}, tools: { register: (x) => { t5[x.name] = x } }, llm: llm5, workingDirectory: { ensure: async () => proyecto }, logger: {} }, { dshHome: path.join(proyecto, 'no-hay') })
  const ex = { agent: { session: { id: 's' }, model: { current: () => ({ provider: 'p', model: 'm' }) } }, signal: new AbortController().signal }
  const r = await t5.memoria_importar.execute({ reconstruir: true, documentos: false }, ex)
  assert.match(r, /reconstruí la memoria con los 2 turnos/)
  assert.ok(vistos[0].indexOf('primero') < vistos[0].indexOf('segundo'), 'orden cronológico')
  assert.ok(vistos.some((v) => v.includes('INSTRUCCIÓN ESPECIAL')), 'condensó porque pasó de 24000')
  assert.equal(await readFile(path.join(proyecto, '.dsh-memoria/bitacora/2026-10.md'), 'utf8'), bitIni, 'no duplicó la bitácora')
  const final = await readFile(path.join(proyecto, 'AGENTS.md'), 'utf8')
  assert.match(final, /- corto/); assert.ok(final.length < 12000)
}
// ======================= 0.3: mejoras =======================

// importancia: al recortar sale primero lo menos importante, no lo más viejo
{
  let b = bloqueVacio()
  b = anotarEnBloque(b, 'hecho', 'dato VIEJO pero CRÍTICO ' + 'x'.repeat(200), '2026-10-01', 5)
  for (let i = 0; i < 40; i++) b = anotarEnBloque(b, 'hecho', `dato menor ${i} ` + 'y'.repeat(200), '2026-11-01', 2)
  const r = recortarSeguro(b, 4000)
  assert.match(r, /dato VIEJO pero CRÍTICO/, 'lo crítico sobrevive aunque sea viejo'); assert.ok(!r.includes('dato menor 0 '))
  assert.equal(importanciaDe('- algo _(2026-11-01 · ★5)_'), 5); assert.equal(importanciaDe('- sin marca'), 3)
}

// elección de recuerdos
{
  const ents = [
    '## 2026-11-01 10:00 · sesión aaaaaaaa\n\n**Pedido:** arreglar el login de supabase que falla con token vencido',
    '## 2026-11-02 10:00 · sesión bbbbbbbb\n\n**Pedido:** cambiar colores del botón',
    '## 2026-11-03 10:00 · sesión cccccccc\n\n**Acciones:**\n- edit `src/ventas/calcularTotal.js`',
  ]
  assert.deepEqual(palabrasClave('¿Qué hacemos con el login de Supabase?'), ['hacemos', 'login', 'supabase'])
  const r1 = elegirRecuerdos(ents, 'otra vez falla el login de supabase')
  assert.equal(r1.length, 1); assert.match(r1[0], /token vencido/)
  assert.equal(elegirRecuerdos(ents, 'hola, buenos días').length, 0, 'charla no trae recuerdos')
  assert.equal(elegirRecuerdos(ents, 'el botón').length, 0, 'una sola palabra común no basta')
  assert.match(elegirRecuerdos(ents, 'revisa src/ventas/calcularTotal.js')[0], /calcularTotal/, 'un archivo específico sí basta')
  assert.equal(elegirRecuerdos(ents, 'login supabase', { excluir: (e) => e.includes('aaaaaaaa') }).length, 0)
  assert.ok(elegirRecuerdos(ents.map((e) => e + ' login supabase ' + 'z'.repeat(2000)), 'login supabase', { maxCaracteres: 1500 }).join('').length <= 1500)
}

// turnos por tandas, urgencia, recuerdo inyectado, consolidar, respaldos y deshacer
{
  const cwd2 = await mkdtemp(path.join(tmpdir(), 'mem03-'))
  const hh = {}; const tt = {}; const ll = []
  const llm = { stream: (o) => { ll.push(o.messages[0].content[0].text); const n = ll.length
    return (async function* () { yield { type: 'text-delta', text: Object.values(SECCIONES).map((s) => `### ${s}\n- versión ${n} _(2026-11-13 · ★3)_`).join('\n') }; yield { type: 'finish', reason: { kind: 'stop' } } })() } }
  apply({ on: (e, f) => { hh[e] = f }, tools: { register: (x) => { tt[x.name] = x } }, llm, workingDirectory: { ensure: async () => cwd2 }, logger: { warn: (m) => { throw new Error('warn: ' + m) } } }, { consolidarCada: 3 })
  const ag = { session: { id: 'session-0000-actual1' }, model: { current: () => ({ provider: 'p', model: 'm' }) } }
  const turno = async (txt, agente = ag) => {
    const d = await hh['agent/pre-step']({ agent: agente, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [{ id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: txt }] }] }))
    hh['tools/result']({ agent: agente, name: 'edit', arguments: { path: 'src/pagos.js' } }, { isError: false, content: [] })
    await hh['agent/turn-stopping']({ agent: agente, signal: new AbortController().signal })
    await new Promise((r) => setTimeout(r, 40))
    return d
  }
  await turno('integrar la pasarela wompi en pagos'); await turno('agregar validación de montos en pagos')
  assert.equal(ll.length, 0, 'dos turnos: todavía pendiente, sin gastar Flash')
  assert.match(await tt.memoria_ver.execute({}, { agent: ag }), /2 turnos pendientes/)
  await turno('conectar webhook de confirmación')
  assert.equal(ll.length, 1, 'al tercer turno resume una sola vez'); assert.match(ll[0], /REGISTRO DE LOS ÚLTIMOS 3 TURNOS[\s\S]*wompi[\s\S]*webhook/)
  assert.equal(await readFile(path.join(cwd2, '.dsh-memoria/pendiente.md'), 'utf8'), '', 'pendiente vaciado')
  await turno('recuerda que siempre usamos pesos colombianos sin decimales')
  assert.equal(ll.length, 2, '"recuerda" resume de inmediato')
  // recuerdo automático en una conversación NUEVA
  const otro = { session: { id: 'session-9999-otra0001' }, model: ag.model }
  const d = await hh['agent/pre-step']({ agent: otro, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [{ id: 'u2', source: { kind: 'user' }, content: [{ type: 'text', text: '¿cómo quedó la pasarela wompi en pagos?' }] }] }))
  assert.equal(d.messages.length, 2); assert.equal(d.messages[0].source.kind, 'dsh-memoria'); assert.equal(d.messages[0].source.form, 'recall')
  assert.match(d.messages[0].content[0].text, /Recuerdos de conversaciones anteriores[\s\S]*wompi/); assert.equal(d.messages[1].id, 'u2')
  assert.ok(Object.isFrozen(d.messages[0]))
  const d2 = await hh['agent/pre-step']({ agent: otro, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [{ id: 'u3', source: { kind: 'user' }, content: [{ type: 'text', text: 'y la pasarela wompi en pagos otra vez' }] }] }))
  assert.equal(d2.messages.length, 1, 'no repite el mismo recuerdo en la misma conversación')
  const d3 = await hh['agent/pre-step']({ agent: ag, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages: [{ id: 'u4', source: { kind: 'user' }, content: [{ type: 'text', text: 'la pasarela wompi en pagos' }] }] }))
  assert.equal(d3.messages.length, 1, 'no recuerda lo de la misma conversación (ya está en contexto)')
  // consolidar a mano
  await turno('ajustar textos del recibo de pago')
  assert.match(await tt.memoria_consolidar.execute({}, { agent: ag }), /Resumí 1 turnos/)
  assert.match(await tt.memoria_consolidar.execute({}, { agent: ag }), /No había/)
  // respaldos y deshacer
  const antes = await tt.memoria_ver.execute({}, { agent: ag }); assert.match(antes, /versión 3/)
  assert.match(await tt.memoria_deshacer.execute({ listar: true }, { agent: ag }), /1\. .*\n2\./)
  assert.match(await tt.memoria_deshacer.execute({}, { agent: ag }), /volvió a la copia 1/)
  assert.match(await tt.memoria_ver.execute({}, { agent: ag }), /versión 2/)
  assert.match(await tt.memoria_deshacer.execute({ pasos: 2 }, { agent: ag }), /copia 2/)
  assert.match(await tt.memoria_ver.execute({}, { agent: ag }), /versión 1/)
  const archivos = await readdir(path.join(cwd2, '.dsh-memoria/respaldos'))
  assert.ok(archivos.some((x) => x.includes('-antes-de-deshacer')))
}
console.log('memoria unit: OK')
