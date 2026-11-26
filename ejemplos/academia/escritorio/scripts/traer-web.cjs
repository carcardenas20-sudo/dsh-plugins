// Compila la interfaz web del proyecto y la copia a escritorio/app.
// Lo configura escritorio.config.json → "web": { "carpeta": "..", "comando": "npm run build -- --base=./", "salida": "dist" }
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const raiz = path.join(__dirname, '..')
const cfg = JSON.parse(fs.readFileSync(path.join(raiz, 'escritorio.config.json'), 'utf8')).web
if (!cfg) { console.log('Sin "web" en escritorio.config.json: se usa la carpeta app/ tal como está.'); process.exit(0) }
const proyecto = path.resolve(raiz, cfg.carpeta || '..')
if (cfg.comando) {
  console.log(`Compilando la interfaz: ${cfg.comando}`)
  execSync(cfg.comando, { cwd: proyecto, stdio: 'inherit', env: { ...process.env, DSH_ESCRITORIO: '1' } })
}
const salida = path.resolve(proyecto, cfg.salida || 'dist')
if (!fs.existsSync(path.join(salida, 'index.html'))) { console.error(`No encontré ${path.join(salida, 'index.html')}. Revisa "web.salida".`); process.exit(1) }
const destino = path.join(raiz, 'app')
fs.rmSync(destino, { recursive: true, force: true })
fs.cpSync(salida, destino, { recursive: true })
console.log(`Interfaz copiada a ${path.relative(process.cwd(), destino) || 'app'}`)
