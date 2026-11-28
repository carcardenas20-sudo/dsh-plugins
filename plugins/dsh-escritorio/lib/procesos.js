// Procesos y proyecto: correr comandos, raíz de git, repositorio de GitHub, proyecto web.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

// ---------- procesos ----------

export function correr(cmd, args, { cwd, timeoutMs, signal, env } = {}) {
  return new Promise((resolve) => {
    let salida = ''
    let h
    try {
      h = spawn(cmd, args, { cwd, signal, windowsHide: true, shell: process.platform === 'win32', env: { ...process.env, ...env } })
    } catch (e) { return resolve({ codigo: null, salida: String(e.message) }) }
    const t = setTimeout(() => h.kill(), timeoutMs ?? 10 * 60_000)
    const mas = (b) => { salida += b.toString('utf8'); if (salida.length > 200_000) salida = salida.slice(-100_000) }
    h.stdout?.on('data', mas); h.stderr?.on('data', mas)
    h.on('error', (e) => { clearTimeout(t); resolve({ codigo: null, salida: salida + String(e.message) }) })
    h.on('close', (codigo) => { clearTimeout(t); resolve({ codigo, salida }) })
  })
}
export const finalDe = (t, n = 3000) => (t.length > n ? '…' + t.slice(-n) : t)
export const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
export const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

export async function raizGit(desde) {
  let d = desde
  for (let i = 0; i < 12; i++) { if (existsSync(path.join(d, '.git'))) return d; const p = path.dirname(d); if (p === d) break; d = p }
  return null
}

export async function repoGithub(raiz) {
  try {
    const cfg = await readFile(path.join(raiz, '.git', 'config'), 'utf8')
    const m = /url\s*=\s*.*github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/m.exec(cfg)
    return m ? { owner: m[1], repo: m[2] } : null
  } catch { return null }
}

export async function detectarWeb(cwd) {
  try {
    const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps.vite && pkg.scripts?.build) return { tipo: 'vite', comando: 'npm run build -- --base=./', salida: 'dist' }
    if (pkg.scripts?.build) return { tipo: 'build', comando: 'npm run build', salida: existsSync(path.join(cwd, 'build')) ? 'build' : 'dist' }
  } catch {}
  return null
}

export async function tamanoLegible(f) { const s = await stat(f); return s.size > 1e6 ? `${(s.size / 1e6).toFixed(1)} MB` : `${Math.round(s.size / 1e3)} KB` }

// ---------- plugin ----------

