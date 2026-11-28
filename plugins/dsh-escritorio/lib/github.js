// GitHub Actions (compilar Windows, Mac y Linux; publicar versiones; sitio de descargas) y página de descargas.
import { slug } from './base.js'

export function flujoGithub({ dirRel, webDirRel, nombre, paginaRel = null, sitio = null }) {
  const enDir = dirRel === '.' ? '' : `\n        working-directory: ${dirRel}`
  const sal = `${dirRel === '.' ? '' : `${dirRel}/`}instaladores`
  return `# Compila ${nombre} para Windows, Mac y Linux en los servidores de GitHub (generado por dsh-escritorio).
# Publicar una versión (las apps ya instaladas la descargan solas y se actualizan al cerrarse), de dos formas:
# - Desde la web: pestaña Actions → Escritorio → Run workflow → escribe la versión (ej. 1.2.0).
# - Con git: git tag escritorio-v1.2.0 && git push origin escritorio-v1.2.0
# - O en Releases → "Draft a new release" con la etiqueta escritorio-v1.2.0 (los instaladores se suben solos).
# "Run workflow" con la versión vacía solo compila (los instaladores quedan en esa ejecución).
name: Escritorio

on:
  push:
    tags: ['escritorio-v*']
  workflow_dispatch:
    inputs:
      version:
        description: 'Versión a publicar, ej. 1.2.0 (mayor que la anterior). Vacío = solo compilar.'
        required: false
        default: ''
      notas:
        description: 'Novedades de esta versión (se ven en la página de descargas).'
        required: false
        default: ''

env:
  VERSION: \${{ startsWith(github.ref, 'refs/tags/escritorio-v') && github.ref_name || inputs.version }}

permissions:
  contents: write

jobs:
  compilar:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
${webDirRel ? `      - name: Dependencias de la interfaz
        run: npm install --no-audit --no-fund
        working-directory: ${webDirRel}
` : ''}      - name: Dependencias de la app${enDir}
        run: npm install --no-audit --no-fund
      - name: Interfaz${enDir}
        run: npm run web
      - name: Versión
        if: env.VERSION != ''${enDir}
        shell: bash
        run: |
          V="\${VERSION#escritorio-v}"
          [[ "$V" =~ ^[0-9]+\\.[0-9]+\\.[0-9]+$ ]] || { echo "::error::La versión debe ser como 1.2.0 (recibí '$V')"; exit 1; }
          npm pkg set version="$V"
      - name: Mac sin Spotlight (evita que el .dmg quede "ocupado")
        if: runner.os == 'macOS'
        run: sudo mdutil -a -i off
      - name: Instaladores${enDir}
        shell: bash
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        run: |
          case "$RUNNER_OS" in Windows) P=--win;; macOS) P=--mac;; *) P=--linux;; esac
          npx electron-builder $P --publish never
      - uses: actions/upload-artifact@v4
        with:
          name: ${slug(nombre) || 'app'}-\${{ runner.os }}
          path: |
            ${sal}/*.exe
            ${sal}/*.dmg
            ${sal}/*.zip
            ${sal}/*.AppImage
            ${sal}/*.blockmap
            ${sal}/latest*.yml
          if-no-files-found: error

  publicar:
    # Solo con versión, y solo si las tres compilaciones salieron bien: así nunca queda una versión a medias.
    needs: compilar
    if: startsWith(github.ref, 'refs/tags/escritorio-v') || inputs.version != ''
    runs-on: ubuntu-latest
${sitio ? `    env:
      TIENE_NETLIFY: \${{ secrets.NETLIFY_AUTH_TOKEN != '' }}
` : ''}    steps:
      - uses: actions/download-artifact@v4
        with:
          path: salida
          merge-multiple: true
      - name: Nombres fijos para la página de descargas (siempre la última versión)
        run: |
          cd salida
          for f in *.exe; do [ "\${f%.blockmap}" = "$f" ] && cp "$f" "${slug(nombre) || 'app'}-windows.exe"; done
          for f in *.dmg; do cp "$f" "${slug(nombre) || 'app'}-mac.dmg"; done
          for f in *.AppImage; do cp "$f" "${slug(nombre) || 'app'}-linux.AppImage"; done
          ls -la
      - name: Versión en Releases
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          ls -la salida
          V="\${VERSION#escritorio-v}"
          T="escritorio-v$V"
          NOTAS="Instaladores de ${nombre} $V. Windows: .exe · Mac: .dmg · Linux: .AppImage. Las apps ya instaladas se actualizan solas."
          if gh release view "$T" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
            # La versión se creó a mano en Releases: se le suben los instaladores.
            gh release upload "$T" salida/* --repo "$GITHUB_REPOSITORY" --clobber
            gh release edit "$T" --repo "$GITHUB_REPOSITORY" --draft=false --prerelease=false --latest
          else
            gh release create "$T" salida/* --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" --title "${nombre} $V" --latest --notes "$NOTAS"
          fi
${sitio ? `      - uses: actions/checkout@v4
        with:
          path: repo
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Sitio de descargas del cliente (${sitio})
        env:
          NOTAS: \${{ inputs.notas }}
        run: node repo/${dirRel === '.' ? '' : `${dirRel}/`}scripts/armar-sitio.cjs --desde salida --salida sitio --notas "$NOTAS"
      - uses: actions/upload-artifact@v4
        with:
          name: sitio-de-descargas
          path: sitio
      - name: Publicar en Netlify (si el repo tiene NETLIFY_AUTH_TOKEN y NETLIFY_SITE_ID)
        env:
          NETLIFY_AUTH_TOKEN: \${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: \${{ secrets.NETLIFY_SITE_ID }}
        if: env.TIENE_NETLIFY == 'true'
        run: npx --yes netlify-cli@17 deploy --dir sitio --prod --site "$NETLIFY_SITE_ID"
` : ''}${paginaRel ? `
  pagina:
    # Página pública de descargas en GitHub Pages (actívala una vez: Settings → Pages → Source: GitHub Actions).
    needs: publicar
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: \${{ steps.despliegue.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ${paginaRel}
      - id: despliegue
        uses: actions/deploy-pages@v4
` : ''}`
}

/** Página pública de descargas: detecta el sistema y apunta siempre a la última versión publicada. */
export function paginaDescargas({ nombre, owner, repo, color = '#0a66ff', descripcion = '' }) {
  const s = slug(nombre) || 'app'
  const base = `https://github.com/${owner}/${repo}/releases/latest/download`
  const e = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Descargar ${e(nombre)}</title>
<meta name="description" content="Descarga ${e(nombre)} para Windows y Mac. Se actualiza sola.">
<link rel="icon" href="icono.png">
<style>
:root{--fondo:#f5f5f7;--sup:#fff;--tinta:#1d1d1f;--suave:#6e6e73;--borde:rgba(0,0,0,.08);--acento:${e(color)};color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--fondo:#000;--sup:#1c1c1e;--tinta:#f5f5f7;--suave:#98989d;--borde:rgba(255,255,255,.1)}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--fondo);color:var(--tinta);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{width:min(720px,calc(100% - 32px));margin:0 auto;padding:72px 0 48px;text-align:center}
.icono{width:96px;height:96px;border-radius:24px;box-shadow:0 12px 40px rgba(0,0,0,.18);margin:0 auto 22px;display:block;background:var(--acento)}
h1{font-size:clamp(34px,6vw,52px);letter-spacing:-.03em;margin:0 0 8px;line-height:1.05}
.sub{color:var(--suave);font-size:19px;margin:0 auto 30px;max-width:520px}
.principal{display:inline-flex;align-items:center;gap:10px;background:var(--acento);color:#fff;text-decoration:none;font-weight:650;font-size:17px;padding:15px 28px;border-radius:999px;box-shadow:0 8px 24px color-mix(in srgb,var(--acento) 35%,transparent);transition:transform .15s,filter .15s}
.principal:hover{filter:brightness(1.07);transform:translateY(-1px)}.principal:active{transform:scale(.98)}
.version{color:var(--suave);font-size:14px;margin-top:14px;min-height:21px}
.otros{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:44px 0 0;text-align:left}
.otro{background:var(--sup);border:1px solid var(--borde);border-radius:18px;padding:18px;text-decoration:none;color:inherit;transition:border-color .15s}
.otro:hover{border-color:var(--acento)}.otro b{display:block;font-size:16px}.otro span{color:var(--suave);font-size:14px}
.ayuda{background:var(--sup);border:1px solid var(--borde);border-radius:18px;padding:20px 22px;margin-top:28px;text-align:left;font-size:14.5px;color:var(--suave)}
.ayuda b{color:var(--tinta)}.ayuda p{margin:6px 0}
footer{color:var(--suave);font-size:13px;margin-top:36px}footer a{color:var(--suave)}
</style></head><body><main>
<img class="icono" src="icono.png" alt="" onerror="this.removeAttribute('src')">
<h1>${e(nombre)}</h1>
<p class="sub">${e(descripcion || 'La app de escritorio. Instálala una vez y se actualiza sola.')}</p>
<a class="principal" id="principal" href="${base}/${s}-windows.exe">Descargar para Windows</a>
<div class="version" id="version"></div>
<div class="otros">
  <a class="otro" href="${base}/${s}-windows.exe"><b>Windows</b><span>Windows 10 y 11 · .exe</span></a>
  <a class="otro" href="${base}/${s}-mac.dmg"><b>Mac</b><span>Intel y Apple (M1–M4) · .dmg</span></a>
  <a class="otro" href="${base}/${s}-linux.AppImage"><b>Linux</b><span>.AppImage</span></a>
</div>
<div class="ayuda">
  <p><b>Windows:</b> si aparece "Windows protegió su PC", toca <b>Más información → Ejecutar de todos modos</b>. Pasa solo la primera vez.</p>
  <p><b>Mac:</b> la primera vez abre la app con clic derecho → <b>Abrir</b>.</p>
  <p><b>Actualizaciones:</b> la app busca versiones nuevas sola y se actualiza al cerrarla. No tienes que volver a esta página.</p>
</div>
<footer><a href="https://github.com/${owner}/${repo}/releases">Todas las versiones</a></footer>
</main>
<script>
(function(){
  var ua = navigator.userAgent, base = ${JSON.stringify(base)}, s = ${JSON.stringify(s)}
  var so = /Mac|iPhone|iPad/.test(ua) ? 'mac' : /Linux/.test(ua) && !/Android/.test(ua) ? 'linux' : 'windows'
  var b = document.getElementById('principal')
  b.href = base + '/' + s + (so === 'mac' ? '-mac.dmg' : so === 'linux' ? '-linux.AppImage' : '-windows.exe')
  b.textContent = 'Descargar para ' + (so === 'mac' ? 'Mac' : so === 'linux' ? 'Linux' : 'Windows')
  fetch('https://api.github.com/repos/${owner}/${repo}/releases/latest').then(function(r){ return r.ok ? r.json() : null }).then(function(v){
    if (!v) return
    var f = new Date(v.published_at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })
    document.getElementById('version').textContent = 'Versión ' + String(v.tag_name).replace(/^escritorio-v/, '') + ' · ' + f
  }).catch(function(){})
})()
</script>
</body></html>
`
}

