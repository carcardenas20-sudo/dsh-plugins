// Apps con Tauri (Rust) y JavaFX (Java): creación, sitio, publicación en GitHub y armado del sitio de descargas.
// (La compilación real se prueba en GitHub Actions; aquí, que todo quede en su sitio.)
import { apply, flujoGithub } from '../plugins/dsh-escritorio/index.js'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)

const base = await mkdtemp(path.join(tmpdir(), 'escritorio-otras-'))
const tools = {}
let cwd
apply({ tools: { register: (t) => (tools[t.name] = t) }, systemPrompt: { section() {} }, workingDirectory: { ensure: async () => cwd } }, {})

for (const tec of ['tauri', 'java']) {
  cwd = path.join(base, tec); await mkdir(path.join(cwd, '.git'), { recursive: true })
  await writeFile(path.join(cwd, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/carcardenas20-sudo/textiles.git\n')
  const r = await tools.escritorio_crear.execute({ nombre: 'Producción Textiles', tecnologia: tec, atajo: 'CommandOrControl+Shift+P' }, {})
  assert.match(r, new RegExp(tec === 'tauri' ? 'Tauri \\(Rust\\)' : 'JavaFX \\(Java\\)'))
  const app = path.join(cwd, 'escritorio')
  const conf = JSON.parse(await readFile(path.join(app, 'escritorio.config.json'), 'utf8'))
  assert.equal(conf.tecnologia, tec); assert.equal(conf.atajo, undefined, 'sin atajo global')
  const comunes = ['app/index.html', 'build/icono.svg', 'motor/motor.cjs', 'motor/servidor.cjs', 'motor/panel/index.html', 'scripts/preparar.cjs', 'scripts/armar-sitio.cjs', 'scripts/icono-png.cjs', 'LEEME.md', '.gitignore']
  const propios = tec === 'tauri' ? ['puente.js', 'src-tauri/src/main.rs', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json', 'src-tauri/capabilities/default.json'] : ['scripts/java.cjs', 'src/main/java/escritorio/App.java', 'src/main/java/escritorio/Servidor.java', 'src/main/resources/escritorio/puente.js']
  for (const f of [...comunes, ...propios]) assert.ok(existsSync(path.join(app, f)), `${tec}: ${f}`)
  assert.ok(!existsSync(path.join(app, 'main.js')), 'no trae archivos de Electron')
  const pkg = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8'))
  assert.ok(!pkg.devDependencies.electron && pkg.dependencies['@supabase/supabase-js'] && pkg.dependencies['playwright-core'])
  if (tec === 'tauri') {
    const tc = JSON.parse(await readFile(path.join(app, 'src-tauri', 'tauri.conf.json'), 'utf8'))
    assert.deepEqual([tc.productName, tc.mainBinaryName, tc.version], ['Producción Textiles', 'produccion-textiles', '../package.json'])
    assert.match(await readFile(path.join(app, 'src-tauri', 'Cargo.toml'), 'utf8'), /name = "produccion-textiles"/)
  } else assert.match(await readFile(path.join(app, 'scripts', 'java.cjs'), 'utf8'), /\|\| '21\.0\.\d+'/)
  // una automatización y los datos no le meten Electron
  await tools.escritorio_automatizacion.execute({ id: 'aviso', nombre: 'Aviso', cuando: { manual: true }, codigo: "return 'ok'" }, {})
  assert.ok(existsSync(path.join(app, 'automatizaciones', 'aviso.js')))
  assert.ok(!JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8')).devDependencies.electron)
  // sitio: siempre con aviso
  const s = await tools.escritorio_sitio.execute({ url: 'https://descargas.textiles.co', modo: 'automatica' }, {})
  assert.match(s, /siempre con aviso/)
  assert.equal(JSON.parse(await readFile(path.join(app, 'escritorio.config.json'), 'utf8')).actualizaciones, 'aviso')
  // GitHub Actions con Rust o Java
  const p = await tools.escritorio_publicar.execute({}, {})
  assert.match(p, new RegExp(tec === 'tauri' ? 'Tauri' : 'JavaFX'))
  const y = await readFile(path.join(cwd, '.github', 'workflows', 'escritorio.yml'), 'utf8')
  assert.match(y, tec === 'tauri' ? /rust-toolchain[^]*tauri build --config src-tauri\/tauri\.extra\.json --bundles \$B/ : /setup-java[^]*java\.cjs empaquetar/)
  assert.doesNotMatch(y, /electron-builder|latest\*\.yml/)
  assert.match(y, /armar-sitio\.cjs --desde salida/)
}
await assert.rejects(tools.escritorio_crear.execute({ nombre: 'Web', tecnologia: 'java', url: 'https://x.co', carpeta: 'otra' }, {}), /Java muestra la interfaz/)

// el sitio de descargas de Tauri/Java no necesita latest*.yml
const { armar } = require('../plugins/dsh-escritorio/plantilla/scripts/armar-sitio.cjs')
const inst = path.join(base, 'inst'); await mkdir(inst)
await writeFile(path.join(inst, 'Produccion Textiles_1.2.0_x64-setup.exe'), 'exe'); await writeFile(path.join(inst, 'produccion-textiles_1.2.0_amd64.deb'), 'deb'); await writeFile(path.join(inst, 'viejo_1.1.0_x64-setup.exe'), 'v')
const { info } = armar({ desde: [inst], salida: path.join(base, 'sitio'), config: { nombre: 'Producción Textiles', tecnologia: 'tauri' }, pkg: { version: '1.2.0' } })
assert.equal(info.version, '1.2.0'); assert.equal(info.archivos.windows.archivo, 'Produccion Textiles_1.2.0_x64-setup.exe'); assert.equal(info.archivos.linux.archivo, 'produccion-textiles_1.2.0_amd64.deb')
assert.throws(() => armar({ desde: [inst], salida: path.join(base, 'sitio2'), config: { nombre: 'E' }, pkg: { version: '1.2.0' } }), /latest\*\.yml/, 'Electron sí los exige')
assert.match(flujoGithub({ dirRel: '.', nombre: 'X', tecnologia: 'electron' }), /electron-builder/)
console.log('tauri y java: ok (crear, automatización, sitio con aviso, GitHub Actions con Rust/Java, sitio sin latest.yml)')
