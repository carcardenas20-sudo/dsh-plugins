// CI: crea una app de prueba (tauri o java) con automatizaciones y una página que se conecta al Supabase real.
import { crearTauri, crearJava } from '../../plugins/dsh-escritorio/lib/otras.js'
import { iconoSvg } from '../../plugins/dsh-escritorio/lib/base.js'
import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import path from 'node:path'
const [dir, tec] = process.argv.slice(2)
const o = { nombre: 'Textiles X Demo', paquete: 'textiles-x-demo', version: '1.0.0', id: 'com.textilesx.demo' }
await mkdir(dir, { recursive: true })
await (tec === 'java' ? crearJava : crearTauri)(dir, o)
for (const d of ['build', 'app', 'automatizaciones']) await mkdir(path.join(dir, d), { recursive: true })
await writeFile(path.join(dir, 'build/icono.svg'), iconoSvg(o.nombre, '#c2410c'))
await writeFile(path.join(dir, 'escritorio.config.json'), JSON.stringify({ nombre: o.nombre, id: o.id, tecnologia: tec, ancho: 1100, alto: 720, minAncho: 420, minAlto: 520, bandeja: true, actualizaciones: 'aviso' }, null, 2))
await writeFile(path.join(dir, 'automatizaciones/con-clave.js'), `module.exports = { nombre: 'Con clave', cuando: { manual: true }, secretos: ['clave'], async ejecutar({ secreto, registro }) { registro('pidiendo clave'); const c = await secreto('clave'); if (c !== 'demo123') throw new Error('clave incorrecta: ' + c); return { largo: c.length } } }`)
await writeFile(path.join(dir, 'automatizaciones/robot.js'), `module.exports = { nombre: 'Robot de navegador', cuando: { manual: true }, async ejecutar({ robot }) { const p = await robot(); await p.goto('data:text/html,<h1>Hola robot</h1>'); const t = await p.textContent('h1'); await p.captura('hola'); return t } }`)
// página: datos-en-vivo con Supabase real (sin iniciar sesión: la clave pública y las políticas deciden)
const web = path.join(dir, 'web-prueba'); await mkdir(web, { recursive: true })
await copyFile(new URL('../../plugins/dsh-escritorio/web/datos-en-vivo.js', import.meta.url), path.join(web, 'datos-en-vivo.js'))
await writeFile(path.join(web, 'entrada.js'), `import { crearDatos } from './datos-en-vivo.js'
const estado = { tecnologia: window.escritorio && window.escritorio.tecnologia, idb: typeof indexedDB, conexion: null, config: null, vacia: null }
const pintar = () => { document.getElementById('s').textContent = JSON.stringify(estado) }
pintar()
let listo; window.escritorioPruebaLista = new Promise((r) => (listo = r))
const d = crearDatos({ url: 'https://mtnfefxgcwgkkqfsdeed.supabase.co', clave: 'sb_publishable_lOIgAO_GkmS8iuS6_APkRQ_rbiuUcRD' })
const revisar = () => { pintar(); if (estado.conexion === 'en-linea' && estado.config && estado.vacia) listo() }
d.alCambiarConexion((c) => { estado.conexion = c.estado; revisar() })
d.enVivo('app_config', {}, (f, i) => { estado.config = i.origen === 'servidor' || i.origen === 'tiempo-real' ? 'servidor:' + f.length : null; revisar() })
d.enVivo('roles', {}, (f, i) => { if (i.origen === 'servidor') estado.vacia = 'roles:' + f.length + ' (sin sesión no ve nada)'; revisar() })
`)
execSync('npm init -y && npm i @supabase/supabase-js@2.119.2 esbuild@0.25 --no-audit --no-fund && npx esbuild entrada.js --bundle --format=iife --target=es2020 --outfile=app.js', { cwd: web, stdio: 'inherit', shell: true })
await copyFile(path.join(web, 'app.js'), path.join(dir, 'app/app.js'))
await writeFile(path.join(dir, 'app/index.html'), '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Prueba Supabase</title><script defer src="./app.js"></script></head><body style="font-family:system-ui;padding:24px"><h1>Textiles X Demo</h1><estado-conexion></estado-conexion><pre id="s" style="white-space:pre-wrap">cargando</pre></body></html>')
console.log('demo creada en', dir)
