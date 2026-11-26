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
assert.match(yml, /windows-latest, macos-latest/); assert.match(yml, /working-directory: apps\/escritorio/); assert.match(yml, /tags: \['escritorio-v\*'\]/)

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

cwd = path.join(base, 'nueva'); await mkdir(cwd)
r = await tools.escritorio_crear.execute({ nombre: 'Notas', bandeja: false }, {})
assert.match(r, /página inicial nueva/); assert.ok(existsSync(path.join(cwd, 'escritorio/app/index.html')))
assert.match(await tools.escritorio_publicar.execute({}, {}), /no es un repositorio de git/)
cwd = path.join(base, 'url'); await mkdir(cwd)
await assert.rejects(tools.escritorio_crear.execute({ nombre: 'X', origen: 'url', url: 'http://inseguro.com' }, {}), /https/)
await assert.rejects(tools.escritorio_crear.execute({ nombre: 'X', carpeta: '../fuera' }, {}), /dentro del proyecto/)
assert.match(await tools.escritorio_probar.execute({ carpeta: 'otra' }, {}), /No hay app de escritorio/)
console.log('escritorio: ok (la apertura real de la app se prueba aparte con Electron)')
