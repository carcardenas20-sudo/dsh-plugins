// Pruebas de dsh-escuadra con agentes simulados sobre un repositorio git real.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as esc from '../plugins/dsh-escuadra/index.js'

// ---------- utilidades puras ----------
assert.ok(esc.coincide('src/ui/Lista.jsx', ['src/ui/']))
assert.ok(esc.coincide('src/ui/a/b.css', ['src/ui/**']))
assert.ok(!esc.coincide('src/api/x.js', ['src/ui/**']))
assert.ok(esc.coincide('src/tipos.ts', ['src/tipos.ts']))
assert.ok(!esc.coincide('src/tipos.tsx', ['src/tipos.ts']))
assert.ok(esc.coincide('pruebas/api.test.js', ['**/*.test.js']))
assert.ok(esc.seSolapan(['src/**'], ['src/ui/**']))
assert.ok(esc.seSolapan(['src/api'], ['src/api/rutas.js']))
assert.equal(esc.seSolapan(['src/ui/**'], ['src/api/**']), null)
assert.equal(esc.seSolapan(['src/tipos.ts'], ['src/ui/**']), null)

const inst = 'Instrucciones suficientemente largas para que el agente sepa qué hacer y cuándo termina.'
const t = (id, archivos, depende = [], rol = 'general') => ({ id, titulo: id, rol, instrucciones: inst, archivos, depende })
let v = esc.validarPlan({ objetivo: 'x', tareas: [t('a', ['src/a/**']), t('b', ['src/b/**'], ['a']), t('c', ['src/c/**'], ['a']), t('d', ['tests/**'], ['b', 'c'])] })
assert.deepEqual(v.errores, []); assert.deepEqual(v.oleadas, [['a'], ['b', 'c'], ['d']])
v = esc.validarPlan({ objetivo: 'x', tareas: [t('a', ['src/**']), t('b', ['src/ui/**'])] })
assert.match(v.errores.join(), /pueden correr a la vez y comparten archivos/)
v = esc.validarPlan({ objetivo: 'x', tareas: [t('a', ['src/**']), t('b', ['src/ui/**'], ['a'])] })
assert.deepEqual(v.errores, [], 'si una depende de la otra, pueden tocar lo mismo')
v = esc.validarPlan({ objetivo: 'x', tareas: [t('a', ['x'], ['b']), t('b', ['y'], ['a'])] })
assert.match(v.errores.join(), /circular/)
v = esc.validarPlan({ objetivo: 'x', tareas: [t('a', ['x'], ['zz']), t('b', ['y'])] })
assert.match(v.errores.join(), /no existe/)
v = esc.validarPlan({ objetivo: 'x', tareas: [{ id: 'a', titulo: 'a', instrucciones: 'corta', archivos: [] }, t('b', ['y'])] })
assert.match(v.errores.join(), /muy cortas[^]*falta "archivos"/)
assert.match(esc.promptTarea({ objetivo: 'Meta' }, { ...t('a', ['src/a/**'], [], 'backend'), verificar: 'npm test' }, { carpetaRel: '.escuadra/x/a' }), /Role: backend[^]*src\/a\/\*\*[^]*npm test/)

// ---------- corrida completa con agentes simulados ----------
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
const repo = await mkdtemp(path.join(os.tmpdir(), 'escuadra-'))
sh(repo, 'init', '-q', '-b', 'main'); sh(repo, 'config', 'user.name', 'Prueba'); sh(repo, 'config', 'user.email', 'prueba@ejemplo.test')
await mkdir(path.join(repo, 'src'), { recursive: true })
await writeFile(path.join(repo, 'src/indice.js'), "export const version = 1\n")
await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'demo', type: 'module' }))
await mkdir(path.join(repo, 'node_modules/libreria'), { recursive: true }); await writeFile(path.join(repo, 'node_modules/libreria/index.js'), 'export default 42\n')
await writeFile(path.join(repo, '.gitignore'), 'node_modules/\n')
sh(repo, 'add', '-A'); sh(repo, 'commit', '-q', '-m', 'inicio')
const base = sh(repo, 'rev-parse', 'HEAD')

const llamadas = []
let rompeVerificacion = true
const agentes = {
  // cada agente simulado recibe la carpeta de su copia y devuelve el informe
  contratos: async (cwd) => { await mkdir(path.join(cwd, 'src/contratos'), { recursive: true }); await writeFile(path.join(cwd, 'src/contratos/pagos.js'), "export const RUTA_PAGOS = '/api/pagos'\n"); return { hecho: true, resumen: 'Contrato de pagos definido.' } },
  api: async (cwd) => {
    assert.ok(existsSync(path.join(cwd, 'src/contratos/pagos.js')), 'la oleada 2 debe ver lo integrado en la oleada 1')
    assert.ok(existsSync(path.join(cwd, 'node_modules/libreria/index.js')), 'las dependencias se enlazan en cada copia')
    await mkdir(path.join(cwd, 'src/api'), { recursive: true })
    await writeFile(path.join(cwd, 'src/api/pagos.js'), "import { RUTA_PAGOS } from '../contratos/pagos.js'\nexport const total = (p) => p.reduce((s, x) => s + x.valor, 0)\nexport { RUTA_PAGOS }\n")
    await writeFile(path.join(cwd, 'src/indice.js'), 'export const version = 99 // fuera de sus archivos\n') // debe descartarse
    await writeFile(path.join(cwd, 'basura.txt'), 'no')
    return { hecho: true, resumen: 'API de pagos lista.', pendientes: ['agregar "zod" a package.json'] }
  },
  interfaz: async (cwd) => { await mkdir(path.join(cwd, 'src/ui'), { recursive: true }); await writeFile(path.join(cwd, 'src/ui/Pagos.js'), "import { RUTA_PAGOS } from '../contratos/pagos.js'\nexport const titulo = 'Pagos'\n"); return { hecho: true, resumen: 'Pantalla de pagos.' } },
  pruebas: async (cwd) => {
    await mkdir(path.join(cwd, 'pruebas'), { recursive: true })
    await writeFile(path.join(cwd, 'pruebas/total.mjs'), "import { total } from '../src/api/pagos.js'\nimport { verificar } from '../src/verificable.js'\nif (total([{ valor: 2 }, { valor: 3 }]) !== 5) process.exit(1)\nverificar()\n")
    return { hecho: true, resumen: 'Prueba del total.' }
  },
}
const subagents = {
  async startActivation({ label, request, delivery }) {
    assert.equal(delivery, 'caller'); assert.ok(request.parent); assert.ok(request.cwd)
    const texto = request.prompt[0].text
    llamadas.push({ label, cwd: request.cwd, texto, esquema: !!request.outputSchema })
    const result = (async () => {
      await new Promise((r) => setTimeout(r, 30))
      if (label.startsWith('reparador')) { await writeFile(path.join(request.cwd, 'src/verificable.js'), 'export const verificar = () => {}\n'); return { output: [{ type: 'text', text: 'Agregué el módulo que faltaba.' }], stopReason: 'completed' } }
      if (label.startsWith('integrador')) { const f = path.join(request.cwd, 'src/comun.js'); await writeFile(f, (await readFile(f, 'utf8')).replace(/^(<<<<<<<|=======|>>>>>>>).*\n/gm, '')); return { output: [{ type: 'text', text: 'Resuelto.' }], stopReason: 'completed' } }
      if (label.startsWith('revisor')) return { output: [], structured: { aprobado: false, resumen: 'Funciona, pero falta validar valores negativos.', problemas: [{ gravedad: 'media', archivo: 'src/api/pagos.js', detalle: 'total() acepta valores negativos' }] }, stopReason: 'completed' }
      const id = texto.match(/## Your task: (\S+)/)[1]
      const informe = await agentes[id](request.cwd)
      return { output: [{ type: 'text', text: 'listo' }], structured: informe, stopReason: 'completed' }
    })()
    return { childId: `hijo-${llamadas.length}`, result, dispose: async () => {} }
  },
}
const herramientas = {}
const ctx = { tools: { register: (d) => { herramientas[d.name] = d } }, subagents, workingDirectory: { ensure: async () => repo }, systemPrompt: { section: (s) => { ctx.seccion = s } }, logger: { info() {} } }
esc.apply(ctx, { maxParalelo: 3 })
assert.match(ctx.seccion.text, /escuadra_repartir/)
const exec = { agent: { id: 'padre' }, signal: new AbortController().signal }

let r = await herramientas.escuadra_repartir.execute({
  objetivo: 'Módulo de pagos con API, pantalla y pruebas', contexto: 'Node con módulos ES', verificacion: 'node pruebas/total.mjs',
  tareas: [
    { ...t('contratos', ['src/contratos/**'], [], 'contratos') },
    { ...t('api', ['src/api/**'], ['contratos'], 'backend') },
    { ...t('interfaz', ['src/ui/**'], ['contratos'], 'interfaz') },
    { ...t('pruebas', ['pruebas/**'], ['api'], 'pruebas'), verificar: 'node -e "process.exit(0)"' },
  ],
}, exec)
assert.match(r, /4 tareas en 3 oleadas[^]*Oleada 2: api \(backend\) · interfaz \(interfaz\)/)
assert.match(await readFile(path.join(repo, '.git/info/exclude'), 'utf8'), /\.escuadra\//)

await writeFile(path.join(repo, 'src/indice.js'), 'cambio sin guardar\n')
assert.match(await herramientas.escuadra_ejecutar.execute({}, exec), /cambios sin guardar/)
sh(repo, 'checkout', '--', 'src/indice.js')

r = await herramientas.escuadra_ejecutar.execute({}, exec)
console.log(r.split('\n').map((l) => '   │ ' + l).join('\n'))
assert.match(r, /✅ contratos[^]*✅ api[^]*descartados: (src\/indice\.js, basura\.txt|basura\.txt, src\/indice\.js)[^]*pendiente: agregar "zod"[^]*✅ interfaz[^]*✅ pruebas/)
assert.match(r, /Verificación general: ✅ pasa \(tras 1 reparación\)/)
assert.match(r, /Revisión independiente: ⚠️ con observaciones[^]*\[media\] src\/api\/pagos\.js/)
assert.match(r, /Aplicado a la rama actual: sí, en main/)
// el resultado quedó en main, sin lo descartado
assert.equal(await readFile(path.join(repo, 'src/indice.js'), 'utf8'), 'export const version = 1\n')
assert.ok(!existsSync(path.join(repo, 'basura.txt')))
for (const f of ['src/contratos/pagos.js', 'src/api/pagos.js', 'src/ui/Pagos.js', 'pruebas/total.mjs', 'src/verificable.js']) assert.ok(existsSync(path.join(repo, f)), f)
execFileSync('node', ['pruebas/total.mjs'], { cwd: repo })
assert.equal(sh(repo, 'merge-base', '--is-ancestor', base, 'HEAD'), '')
assert.equal(sh(repo, 'status', '--porcelain'), '')
assert.equal(sh(repo, 'worktree', 'list').split('\n').length, 1, 'las copias de trabajo se borran al final')
// paralelismo: api e interfaz arrancaron sobre la misma base integrada, en carpetas distintas
const cwdApi = llamadas.find((l) => l.label.includes('backend')).cwd, cwdUi = llamadas.find((l) => l.label.includes('interfaz')).cwd
assert.notEqual(cwdApi, cwdUi)
assert.ok(llamadas.filter((l) => !/revisor|reparador|integrador/.test(l.label)).every((l) => l.esquema))
const log = sh(repo, 'log', '--format=%s')
assert.match(log, /escuadra: reparación[^]*escuadra: integra pruebas[^]*escuadra: integra api[^]*escuadra\(contratos\)/)

// ---------- conflicto forzado → integrador ----------
await writeFile(path.join(repo, 'src/comun.js'), 'export const a = 1\n'); sh(repo, 'add', '-A'); sh(repo, 'commit', '-q', '-m', 'comun')
agentes.uno = async (cwd) => { await writeFile(path.join(cwd, 'src/comun.js'), 'export const a = 1\nexport const uno = 1\n'); return { hecho: true, resumen: 'uno' } }
agentes.dos = async (cwd) => { await writeFile(path.join(cwd, 'src/comun.js'), 'export const a = 1\nexport const dos = 2\n'); return { hecho: true, resumen: 'dos' } }
const planForzado = { objetivo: 'forzar conflicto', tareas: [t('uno', ['src/comun.js']), t('dos', ['src/comun.js'])], oleadas: [['uno', 'dos']] }
await writeFile(path.join(repo, '.escuadra/plan.json'), JSON.stringify(planForzado))
r = await herramientas.escuadra_ejecutar.execute({}, exec)
assert.match(r, /Integración dos: conflicto en src\/comun\.js → resuelto por el integrador/)
const comun = await readFile(path.join(repo, 'src/comun.js'), 'utf8')
assert.match(comun, /uno = 1[^]*dos = 2|dos = 2[^]*uno = 1/); assert.doesNotMatch(comun, /<<<<<<<|>>>>>>>/)

// ---------- limpiar ----------
assert.ok(sh(repo, 'branch', '--list', 'escuadra/*'))
r = await herramientas.escuadra_limpiar.execute({}, exec)
assert.match(r, /ramas borradas/); assert.equal(sh(repo, 'branch', '--list', 'escuadra/*'), '')

// ---------- sin git ----------
const sinGit = await mkdtemp(path.join(os.tmpdir(), 'sin-git-'))
const ctx2 = { ...ctx, workingDirectory: { ensure: async () => sinGit }, tools: { register: (d) => { ctx2[d.name] = d } } }
esc.apply(ctx2)
assert.match(await ctx2.escuadra_repartir.execute({ objetivo: 'x', tareas: [] }, exec), /no es un repositorio git/)

console.log('escuadra: ok')
