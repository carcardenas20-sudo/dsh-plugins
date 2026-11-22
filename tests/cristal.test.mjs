import { apply, detectarProyecto, instruccionesConexion, textoRevision } from '../plugins/dsh-cristal/index.js'
import { paletaMarca, contraste } from '../plugins/dsh-cristal/marca.js'
import { objetivoValido, buscarNavegador } from '../plugins/dsh-cristal/revisor.js'
import { textoGuia } from '../plugins/dsh-cristal/guia.js'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const hx = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
// paleta de marca: texto legible sobre el botón y tinta legible sobre el fondo suave
for (const c of ['#0b63f6', '#ffd400', '#e11d48', '#10b981', '#7c3aed', '#111111']) {
  const p = paletaMarca(c)
  assert.ok(contraste(hx(p.texto), hx(p.base)) >= 4.4 || p.avisos.length, `${c} texto`)
  const suave = hx(p.base).map((x) => x * 0.11 + 255 * 0.89)
  assert.ok(contraste(hx(p.tinta), suave) >= 4.5, `${c} tinta ${p.tinta}`)
  assert.ok(contraste(hx(p.oscuro), [22, 22, 24]) >= 4.5, `${c} oscuro`)
}
assert.equal(paletaMarca('#ffd400').texto, '#1d1d1f')
assert.throws(() => paletaMarca('azul'), /hexadecimal/)
assert.ok(objetivoValido('http://localhost:5173/a') && objetivoValido('http://127.0.0.1:8080') && objetivoValido('C:\\p\\a.html'))
assert.ok(!objetivoValido('https://google.com') && !objetivoValido('http://10.0.0.5'))
assert.match(textoGuia(), /PRINCIPIOS CRISTAL[^]*### hoja[^]*dialog class="cr-hoja"/)
assert.match(textoGuia('react'), /className/)

// detección y conexión
const base = await mkdtemp(path.join(tmpdir(), 'cristal-'))
const react = path.join(base, 'react'); await mkdir(path.join(react, 'src'), { recursive: true })
await writeFile(path.join(react, 'package.json'), JSON.stringify({ dependencies: { react: '18.3.1' }, devDependencies: { tailwindcss: '^3.4.0' } }))
await writeFile(path.join(react, 'src', 'main.tsx'), '')
let p = await detectarProyecto(react)
assert.deepEqual([p.tipo, p.tailwind, p.carpeta, p.entrada, p.ts], ['react', 3, 'src/cristal', 'src/main.tsx', true])
const con = instruccionesConexion(p, 'src/cristal').join('\n')
assert.match(con, /import "\.\/cristal\/cristal\.css"/); assert.match(con, /presets: \[require\("\.\/src\/cristal\/cristal\.tailwind3\.cjs"\)\]/); assert.match(con, /interface Window/)
const java = path.join(base, 'java'); await mkdir(java); await writeFile(path.join(java, 'build.gradle'), '')
assert.equal((await detectarProyecto(java)).carpeta, 'src/main/resources/static/cristal')

// herramientas y control de entrega
const cwd = path.join(base, 'web'); await mkdir(cwd)
const tools = {}, hooks = {}, steers = []
let seccion
const agent = { steer: (m) => steers.push(m) }
apply({ tools: { register: (t) => (tools[t.name] = t) }, systemPrompt: { section: (s) => (seccion = s) }, workingDirectory: { ensure: async () => cwd }, on: (n, f) => (hooks[n] = f) }, {})
assert.match(seccion.text, /cristal_revisar/)
let r = await tools.cristal_instalar.execute({ acento: '#e11d48', nombre: 'Prueba' }, { agent })
assert.match(r, /Instalado Cristal[^]*#e11d48[^]*<link rel="stylesheet" href="cristal\/cristal\.css">/)
for (const f of ['cristal.css', 'cristal.js', 'marca.css', 'galeria.html', 'LEEME.md']) assert.ok(existsSync(path.join(cwd, 'cristal', f)), f)
assert.equal(JSON.parse(await readFile(path.join(cwd, '.dsh-cristal.json'), 'utf8')).acento, '#e11d48')
r = await tools.cristal_instalar.execute({}, { agent })
assert.match(r, /Actualizado[^]*se conservó/)
assert.match(await readFile(path.join(cwd, 'cristal', 'marca.css'), 'utf8'), /--cr-acento-base: #e11d48/)
await assert.rejects(tools.cristal_instalar.execute({ carpeta: '../fuera' }, { agent }), /dentro del proyecto/)
await assert.rejects(tools.cristal_revisar.execute({ objetivo: 'https://example.com' }, { agent }), /servidores locales/)

const usuario = { role: 'user', id: 'u', source: { kind: 'user' }, content: [{ type: 'text', text: 'haz la pantalla' }] }
await hooks['agent/pre-step']({ agent }, async () => ({ kind: 'enter', messages: [usuario] }))
// edita una pantalla y quiere entregar sin revisar → recordatorio
await hooks['tools/pre-execute']({ agent, name: 'write', arguments: { file_path: 'pagina.html' } }, async () => {})
await hooks['agent/turn-stopping']({ agent })
assert.equal(steers.length, 1); assert.match(steers[0].content[0].text, /\[Cristal\][^]*pagina\.html[^]*cristal_revisar/)
assert.equal(steers[0].source.form, 'notice')

if (!buscarNavegador()) { console.log('cristal: sin navegador, se omite la revisión visual'); process.exit(0) }
// página mala → problemas; al cerrar el turno insiste con ellos
await writeFile(path.join(cwd, 'pagina.html'), '<!doctype html><meta name=viewport content="width=device-width"><link rel=stylesheet href="cristal/cristal.css"><body><div style="width:1600px;transition:width .4s">ancho fijo</div><button style="padding:1px;font-size:12px">ok</button></body>')
r = await tools.cristal_revisar.execute({ objetivo: 'pagina.html' }, { agent })
assert.match(r, /❌ pagina\.html[^]*se sale de la pantalla[^]*área de toque pequeña/)
assert.ok(existsSync(path.join(cwd, '.dsh-cristal/capturas/pagina-celular.png')))
await hooks['agent/turn-stopping']({ agent })
assert.equal(steers.length, 2); assert.match(steers[1].content[0].text, /pagina\.html tenía \d+ problema/)
// tope de recordatorios por pedido
await hooks['agent/turn-stopping']({ agent }); assert.equal(steers.length, 2)
// la galería del kit pasa limpia
r = await tools.cristal_revisar.execute({ objetivo: 'cristal/galeria.html' }, { agent })
assert.match(r, /✅ cristal\/galeria\.html: sin problemas importantes/, r)
// nuevo pedido sin tocar interfaz: no molesta con lo viejo
await hooks['agent/pre-step']({ agent }, async () => ({ kind: 'enter', messages: [usuario] }))
await hooks['agent/turn-stopping']({ agent }); assert.equal(steers.length, 2)
assert.match(textoRevision({ disponible: false, motivo: 'x' }, 'a', cwd).texto, /No pude revisar/)
console.log('cristal: ok')
