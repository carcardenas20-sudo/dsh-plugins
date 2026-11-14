import { apply, documento, rutaSegura, slug } from '../plugins/dsh-lienzo/index.js'
import { recursosExternos, candidatosNavegador, buscarNavegador, unirVistas } from '../plugins/dsh-lienzo/revisor.js'
import * as bio from './fixtures/lienzo-biometrador.mjs'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// documento
const d = documento({ titulo: 'A <b>', cuerpo: '<p>hola mundo</p>' })
assert.match(d, /^<!DOCTYPE html>/); assert.match(d, /<title>A &lt;b&gt;<\/title>/)
assert.match(d, /<div class="lz-pagina">\n<p>hola mundo<\/p>/, 'envuelve en lz-pagina')
assert.match(documento({ titulo: 'x', cuerpo: '<html><body><div class="lz-pagina">ok</div></body></html>' }), /<body>\n<button[^]*<div class="lz-pagina">ok<\/div>/)
assert.ok(!/<\/style>\s*<\/style>/.test(documento({ titulo: 'x', cuerpo: 'c', estilos: 'a{}</style><script>' })))
// utilidades
assert.deepEqual(recursosExternos('<script src="https://x.com/a.js"></script><img src="logo.png"><link href="//fonts.g/x">'), ['script → https://x.com/a.js', 'link → //fonts.g/x'])
assert.ok(candidatosNavegador({ ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\L' }, 'win32').includes('C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe'))
assert.equal(slug('Pantalla de cola — Biometría'), 'pantalla-de-cola-biometria')
assert.throws(() => rutaSegura('/p', '../x.html'), /dentro del proyecto/)
assert.equal(unirVistas([{ tipo: 't', donde: 'a', gravedad: 'media', vista: 'escritorio' }, { tipo: 't', donde: 'a', gravedad: 'media', vista: 'celular' }, { tipo: 'u', donde: 'b', gravedad: 'alta', vista: 'celular' }])[0].tipo, 'u')

// herramientas con navegador real
const nav = buscarNavegador()
const cwd = await mkdtemp(path.join(tmpdir(), 'lienzo-'))
const tools = {}, hooks = {}, steers = []
let seccion
const agent = { steer: (m) => steers.push(m) }
apply({
  tools: { register: (t) => (tools[t.name] = t) },
  systemPrompt: { section: (s) => (seccion = s) },
  workingDirectory: { ensure: async () => cwd },
  on: (n, f) => (hooks[n] = f),
}, {})
assert.match(seccion.text, /lienzo_guia/)
assert.match(await tools.lienzo_guia.execute({}), /storyboard[^]*lz-escena/)
assert.match(await tools.lienzo_guia.execute({ pieza: 'kpis' }), /lz-kpi/)

if (!nav) { console.log('lienzo: sin navegador, se omiten pruebas visuales'); process.exit(0) }

// 1) página mala → problemas, queda pendiente; al cerrar el turno, steer
const malo = `<div class="lz-pagina"><header class="lz-encabezado"><h1>Malo</h1></header>
  <section class="lz-seccion"><h2>Datos</h2><div style="width:1600px" class="lz-tarjeta">Franja fija que se sale de la pantalla</div>
  <p style="color:#d8d8d8">gris ilegible sobre fondo claro</p></section></div>`
let r = await tools.lienzo_crear.execute({ titulo: 'Cola biometrador', cuerpo: malo }, { agent })
assert.match(r, /Guardado en lienzos\/cola-biometrador\.html/)
assert.match(r, /se sale de la pantalla/); assert.match(r, /contraste bajo/)
assert.ok(existsSync(path.join(cwd, 'lienzos/capturas/cola-biometrador-escritorio.png')))
assert.ok(existsSync(path.join(cwd, 'lienzos/capturas/cola-biometrador-celular.png')))
await hooks['agent/turn-stopping']({ agent })
assert.equal(steers.length, 1); assert.match(steers[0].content[0].text, /\[Lienzo\][^]*se sale de la pantalla/)
assert.equal(steers[0].source.form, 'notice')

// 2) corregida con el ejemplo bueno → sin problemas, sin steer
r = await tools.lienzo_crear.execute({ titulo: bio.titulo, cuerpo: bio.cuerpo, archivo: 'lienzos/cola-biometrador.html' }, { agent })
assert.match(r, /✅ Revisión visual sin problemas/, r)
assert.match(r, /present/)
await hooks['agent/turn-stopping']({ agent })
assert.equal(steers.length, 1)

// 3) edición a mano que rompe la página → se revisa sola al cerrar el turno
const f = path.join(cwd, 'lienzos/cola-biometrador.html')
await hooks['tools/pre-execute']({ agent, name: 'edit', arguments: { file_path: 'lienzos/cola-biometrador.html' } }, async () => {})
await writeFile(f, (await readFile(f, 'utf8')).replace('<h1>', '<h1 style="white-space:nowrap;width:120px;overflow:hidden">'))
await hooks['agent/turn-stopping']({ agent })
assert.equal(steers.length, 2); assert.match(steers[1].content[0].text, /contenido cortado/)

// 4) tope de rondas: no insiste más de 2 veces por pedido
await hooks['agent/turn-stopping']({ agent })
assert.equal(steers.length, 2)
// 5) lienzo_revisar
assert.match(await tools.lienzo_revisar.execute({ archivo: 'lienzos/cola-biometrador.html' }, { agent }), /contenido cortado/)
console.log('lienzo: ok')
