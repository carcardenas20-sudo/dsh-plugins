import { apply, slug, reloj, esDudoso, parrafos, aMarkdown, vocabularioDe, pideDictado, textoPlano } from '../plugins/dsh-transcriptor/index.js'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

assert.equal(slug('Reunión Suzuka 14-nov.m4a'), 'reunion-suzuka-14-nov')
assert.equal(reloj(3725.9), '01:02:05')
const seg = (i, f, t, logprob = -0.2, silencio = 0.01, compresion = 1.2) => ({ i, f, t, logprob, silencio, compresion })
assert.ok(esDudoso(seg(0, 1, 'x', -1.3)) && esDudoso(seg(0, 1, 'x', -0.2, 0.1, 3)) && !esDudoso(seg(0, 1, 'x')))
const ps = parrafos([seg(0, 2, 'Hola.'), seg(2.2, 4, 'Seguimos.'), seg(9, 10, 'Otra idea.', -1.5)])
assert.equal(ps.length, 2); assert.equal(ps[0].texto, 'Hola. Seguimos.'); assert.equal(ps[1].texto, '⚠[Otra idea.]')
assert.equal(textoPlano([seg(0, 1, ' Hola '), seg(1, 2, 'mundo ')]), 'Hola mundo')
const md = aMarkdown({ segmentos: [seg(0, 2, 'Hola.'), seg(9, 10, 'Duda', -1.5)], duracion: 65, idioma: 'es', modelo: 'm', dispositivo: 'cpu' }, { nombre: 'a.mp3', archivo: 'a.mp3', fecha: 'hoy' })
assert.match(md, /Duración: 00:01:05/); assert.match(md, /\*\*1 parte\(s\) dudosa\(s\)\*\*/); assert.match(md, /\*\*\[00:00:09\]\*\* ⚠\[Duda\]/)
const voc = vocabularioDe(['Suzuka usa AULAPP y SICOV. En Suzuka el Humanejo atiende. Humanejo es de Girardot; Girardot. Para todo. Para nada.'], ['Biometrador'])
assert.ok(voc.startsWith('Biometrador')); for (const w of ['Suzuka', 'AULAPP', 'SICOV', 'Humanejo', 'Girardot']) assert.ok(voc.includes(w), w)
assert.ok(!voc.includes('Para'))
assert.ok(pideDictado('dictado') && pideDictado('Usa mi dictado.') && pideDictado('haz esto [dictado]') && !pideDictado('revisa el dictado de ayer por favor'))

// flujo con el motor de prueba (necesita python3)
let py = null
for (const c of ['python3', 'python']) { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); py = c; break } catch {} }
if (!py) { console.log('transcriptor: sin python, se omite el flujo'); process.exit(0) }
process.env.DSH_TRANSCRIPTOR_FALSO = '1'
const cwd = await mkdtemp(path.join(tmpdir(), 'transcriptor-'))
await writeFile(path.join(cwd, 'AGENTS.md'), 'Suzuka y AULAPP. Suzuka integra AULAPP.')
await writeFile(path.join(cwd, 'reunion.m4a'), 'audio de mentira')
const tools = {}, hooks = {}
let limpiar
const agent = {}
const montar = (cfg) => apply({ tools: { register: (t) => (tools[t.name] = t) }, systemPrompt: { section() {} }, workingDirectory: { ensure: async () => cwd }, on: (n, f) => (hooks[n] = f), effect: (f) => { limpiar = f() } }, cfg)

// sin motor instalado: lo dice claro
montar({ carpetaMotor: path.join(cwd, 'no-existe'), puerto: 0 })
assert.match(await tools.transcribir.execute({ archivo: 'reunion.m4a' }, { agent }), /no está instalado[^]*transcriptor_preparar/)
await assert.rejects(tools.transcribir.execute({ archivo: 'nada.mp3' }, { agent }), /no existe/)
limpiar()

montar({ python: py, puerto: 0 })
let r = await tools.transcribir.execute({ archivo: 'reunion.m4a' }, { agent })
assert.match(r, /Transcripción lista: transcripciones\/reunion\.md \(00:00:11 de audio, 1 parte\(s\) dudosa/)
const arch = await readFile(path.join(cwd, 'transcripciones/reunion.md'), 'utf8')
assert.match(arch, /\*\*\[00:00:00\]\*\* Hola, esta es una prueba del transcriptor\. El aprendiz llega a la sede de Girardot\./)
assert.match(arch, /\*\*\[00:00:08\]\*\* ⚠\[Algo que no se entendió bien\.\]/)
assert.match(await tools.transcripcion_estado.execute({}, { agent }), /#1 reunion\.m4a: listo/)
assert.match(await tools.transcriptor_vocabulario.execute({ accion: 'agregar', palabras: ['Humanejo'] }, { agent }), /Se le pasa al transcriptor: Humanejo, AULAPP, Suzuka/)
assert.match(await tools.transcriptor_preparar.execute({}, { agent }), /Listo: ya se puede transcribir/)

// página de dictado
const enlace = /http:\/\/127\.0\.0\.1:\d+\/d\/[0-9a-f]{24}\//.exec(await tools.dictado_abrir.execute({}, { agent }))[0]
assert.match(await (await fetch(enlace)).text(), /Empezar a dictar/)
assert.deepEqual(await (await fetch(enlace + 'estado')).json(), { motor: true })
assert.equal((await fetch(enlace.replace(/[0-9a-f]{24}/, 'a'.repeat(24)))).status, 404)
assert.equal((await fetch(enlace + 'audio', { method: 'POST', headers: { origin: 'https://malo.com' }, body: 'x' })).status, 403)
const j = await (await fetch(enlace + 'audio', { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: Buffer.alloc(4000, 1) })).json()
assert.match(j.texto, /^Hola, esta es una prueba[^]*no se entendió bien\.$/); assert.equal(j.dudosos, 1)
assert.ok(existsSync(path.join(cwd, 'transcripciones/dictados')))

// "dictado" en el chat entrega lo dictado una sola vez
const usuario = (t) => ({ role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: t }] })
const entrar = (t) => hooks['agent/pre-step']({ agent }, async () => ({ kind: 'enter', messages: [usuario(t)] }))
let d = await entrar('dictado')
assert.equal(d.messages.length, 2); assert.match(d.messages[1].content[0].text, /\[Dictado\][^]*Hola, esta es una prueba/); assert.equal(d.messages[1].source.form, 'recall')
d = await entrar('dictado'); assert.match(d.messages[1].content[0].text, /no hay ninguno pendiente/)
d = await entrar('arregla el login'); assert.equal(d.messages.length, 1)
// corrección desde la página
await fetch(enlace + 'audio', { method: 'POST', body: Buffer.alloc(4000, 1) })
await fetch(enlace + 'dictado', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: 'Texto corregido a mano' }) })
d = await entrar('usa mi dictado'); assert.match(d.messages[1].content[0].text, /Texto corregido a mano$/)

// subir una grabación desde la página
const s = await (await fetch(enlace + 'archivo?nombre=' + encodeURIComponent('Nota de voz.opus'), { method: 'POST', body: Buffer.alloc(5000, 2) })).json()
assert.equal(s.salida, 'transcripciones/nota-de-voz.md')
for (let i = 0; i < 50 && !existsSync(path.join(cwd, s.salida)); i++) await new Promise((r2) => setTimeout(r2, 100))
assert.ok(existsSync(path.join(cwd, s.salida)) && existsSync(path.join(cwd, 'transcripciones/audios/Nota de voz.opus')))
limpiar()
console.log('transcriptor: ok')
