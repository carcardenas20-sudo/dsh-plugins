import { apply, validarAtajo, paqueteApp, flujoGithub, iconoSvg, slug } from '../plugins/dsh-escritorio/index.js'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

assert.equal(validarAtajo('CommandOrControl+Shift+K'), 'CommandOrControl+Shift+K')
assert.equal(validarAtajo(null), null)
assert.throws(() => validarAtajo('K'), /atajo inválido/)
assert.throws(() => validarAtajo('Ctrl+Hola'), /atajo inválido/)
assert.equal(slug('Créditos Suzuka'), 'creditos-suzuka')
assert.match(iconoSvg('Créditos Suzuka', '#e11d48'), />CS<\/text>/)
const pkg = paqueteApp({ nombre: 'Créditos', paquete: 'creditos', version: '1.0.0', id: 'com.x.creditos', github: { owner: 'o', repo: 'r' } })
assert.equal(pkg.build.win.target[0].target, 'nsis'); assert.deepEqual(pkg.build.mac.target[0].arch, ['universal'])
assert.equal(pkg.build.publish[0].repo, 'r'); assert.ok(pkg.devDependencies.electron && pkg.dependencies['electron-updater'])
const yml = flujoGithub({ dirRel: 'apps/escritorio', webDirRel: '.', nombre: 'Créditos' })
assert.match(yml, /windows-latest, macos-latest, ubuntu-latest/);
assert.match(yml, /needs: compilar/); assert.match(yml, /gh release create "\$T"/); assert.match(yml, /gh release upload/); assert.match(yml, /latest\*\.yml/)
assert.match(yml, /inputs\.version != ''/); assert.doesNotMatch(yml, /if: env\.VERSION != ''\n    runs-on/)
assert.ok(pkg.build.mac.target.some((t) => t.target === 'zip'), 'Mac necesita .zip para actualizarse')
assert.ok(!/\$\{productName\}/.test(pkg.build.artifactName), 'el nombre del instalador no debe llevar espacios')
 assert.match(yml, /working-directory: apps\/escritorio/); assert.match(yml, /tags: \['escritorio-v\*'\]/)

const base = await mkdtemp(path.join(tmpdir(), 'escritorio-'))
const tools = {}
let seccion
apply({ tools: { register: (t) => (tools[t.name] = t) }, systemPrompt: { section: (s) => (seccion = s) }, workingDirectory: { ensure: async () => cwd } }, {})
let cwd = path.join(base, 'vite'); await mkdir(path.join(cwd, '.git'), { recursive: true })
await writeFile(path.join(cwd, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/carcardenas20-sudo/mi-app.git\n')
await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' }, devDependencies: { vite: '5.4.11' } }))
assert.match(seccion.text, /escritorio_probar/)
let r = await tools.escritorio_crear.execute({ nombre: 'Academia', atajo: 'CommandOrControl+Shift+A' }, {})
assert.match(r, /proyecto web de la raíz[^]*--base=\.\/[^]*GitHub carcardenas20-sudo\/mi-app/)
for (const f of ['main.js', 'preload.js', 'package.json', 'escritorio.config.json', 'build/icono.svg', 'scripts/icono.cjs', 'scripts/traer-web.cjs', 'LEEME.md', '.gitignore']) assert.ok(existsSync(path.join(cwd, 'escritorio', f)), f)
const conf = JSON.parse(await readFile(path.join(cwd, 'escritorio', 'escritorio.config.json'), 'utf8'))
assert.deepEqual([conf.web.carpeta, conf.web.salida, conf.bandeja, conf.atajo], ['..', 'dist', true, 'CommandOrControl+Shift+A'])
await assert.rejects(tools.escritorio_crear.execute({ nombre: 'Academia' }, {}), /ya existe/)
r = await tools.escritorio_publicar.execute({}, {})
assert.match(r, /Flujo escrito: \.github\/workflows\/escritorio\.yml[^]*git tag escritorio-v1\.0\.0/)
assert.match(await readFile(path.join(cwd, '.github/workflows/escritorio.yml'), 'utf8'), /working-directory: escritorio/)

// automatizaciones
assert.match(seccion.text, /escritorio_automatizacion/); assert.ok(pkg.dependencies['playwright-core'] && pkg.build.files.includes('automatizaciones/**/*'))
r = await tools.escritorio_automatizacion.execute({ id: 'Descargar Pagos', nombre: 'Descargar pagos', cuando: [{ cron: '0 18 * * 1-5' }, { manual: true }], reintentos: 2, codigo: "const p = await robot({ sesion: 'plataforma' })\nawait p.goto(config.plataforma)\nreturn 'listo'", variables: { plataforma: 'https://x.test' } }, {})
assert.match(r, /automatizaciones\/descargar-pagos\.js[^]*soloAutomatizaciones: \["descargar-pagos"\]/)
const auto = await readFile(path.join(cwd, 'escritorio/automatizaciones/descargar-pagos.js'), 'utf8')
assert.match(auto, /cron": "0 18 \* \* 1-5"/); assert.match(auto, /reintentos: 2/); assert.match(auto, /async ejecutar\(\{ disparo,[^}]*robot[^}]*\}\)/)
assert.equal(JSON.parse(await readFile(path.join(cwd, 'escritorio/escritorio.config.json'), 'utf8')).variables.plataforma, 'https://x.test')
assert.match(await tools.escritorio_automatizacion.execute({ id: 'descargar-pagos', nombre: 'x', codigo: 'return 1' }, {}), /Ya existe/)
assert.match(await tools.escritorio_automatizacion.execute({ id: 'mala', nombre: 'x', cuando: { cron: '0 25 * * *' }, codigo: 'return 1' }, {}), /Disparador inválido[^]*25/)
assert.match(await tools.escritorio_automatizacion.execute({ id: 'mala', nombre: 'x', cuando: { cada: '2s' }, codigo: 'return 1' }, {}), /10 segundos/)
assert.match(await tools.escritorio_automatizacion.execute({ id: 'mala', nombre: 'x', codigo: 'const = ;' }, {}), /no compila/)
assert.match(await tools.escritorio_automatizacion.execute({ id: 'tabla', nombre: 'x', cuando: { tabla: 'pagos', evento: 'INSERT' }, codigo: 'return disparo.fila' }, {}), /necesita la base de datos/)
// base de datos
const jwt = (rol) => ['e30', Buffer.from(JSON.stringify({ role: rol })).toString('base64url'), 'firma'].join('.')
assert.match(await tools.escritorio_datos.execute({ url: 'https://abcd.supabase.co', clave: jwt('service_role') }, {}), /service_role/)
assert.match(await tools.escritorio_datos.execute({ url: 'https://abcd.supabase.co', clave: 'sb_secret_123' }, {}), /SECRETA/)
r = await tools.escritorio_datos.execute({ url: 'https://abcd.supabase.co/', clave: jwt('anon'), instalar: false }, {})
assert.match(r, /conectada[^]*datos-en-vivo\.js[^]*row level security[^]*supabase_realtime/i)
assert.deepEqual(JSON.parse(await readFile(path.join(cwd, 'escritorio/escritorio.config.json'), 'utf8')).supabase, { url: 'https://abcd.supabase.co', clave: jwt('anon') })
assert.match(await readFile(path.join(cwd, 'lib/datos-en-vivo.js'), 'utf8'), /export function crearDatos/)

cwd = path.join(base, 'nueva'); await mkdir(cwd)
r = await tools.escritorio_crear.execute({ nombre: 'Notas', bandeja: false }, {})
assert.match(r, /página inicial nueva/); assert.ok(existsSync(path.join(cwd, 'escritorio/app/index.html')))
assert.match(await tools.escritorio_publicar.execute({}, {}), /no es un repositorio de git/)
cwd = path.join(base, 'url'); await mkdir(cwd)
await assert.rejects(tools.escritorio_crear.execute({ nombre: 'X', origen: 'url', url: 'http://inseguro.com' }, {}), /https/)
await assert.rejects(tools.escritorio_crear.execute({ nombre: 'X', carpeta: '../fuera' }, {}), /dentro del proyecto/)
assert.match(await tools.escritorio_probar.execute({ carpeta: 'otra' }, {}), /No hay app de escritorio/)
console.log('escritorio: ok (la apertura real de la app se prueba aparte con Electron)')
