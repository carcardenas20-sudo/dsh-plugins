// Pantalla de inicio de sesión, usuario y estado de conexión listos (generado por dsh-escritorio).
// Son componentes web: funcionan igual en React, Vue o HTML plano, en la web y en la app de escritorio.
//
//   import { crearDatos } from './datos-en-vivo.js'
//   import { conectarUI } from './escritorio-ui.js'
//   const datos = crearDatos({ url, clave })
//   conectarUI(datos, { titulo: 'Academia', subtitulo: 'Inicia sesión para continuar' })
//
//   <acceso-escritorio>   … toda tu app aquí: solo se muestra con sesión iniciada …   </acceso-escritorio>
//   <estado-conexion></estado-conexion>      "En línea" · "Sin conexión · 3 cambios por subir" · "Reconectando…" (+ conflictos y rechazados)
//   <usuario-escritorio></usuario-escritorio> nombre, rol y botón Salir
//   <admin-usuarios></admin-usuarios>         usuarios, roles y permisos, y actividad de automatizaciones (solo quien gestiona usuarios)
//
// Usa los colores de Cristal si están (--cr-acento, --cr-superficie…); si no, trae los suyos, con modo oscuro.

const ESTILO_BASE = `
  :host { --a: var(--cr-acento, #0a66ff); --a-txt: var(--cr-acento-texto, #fff); --sup: var(--cr-superficie, #fff); --fondo: var(--cr-fondo, #f5f5f7);
    --txt: var(--cr-texto, #1d1d1f); --txt2: var(--cr-texto-2, #6e6e73); --borde: var(--cr-borde, rgba(0,0,0,.1)); --err: var(--cr-error, #d93025);
    --ok: var(--cr-ok, #1f9d55); --aviso: var(--cr-aviso, #b26a00); --r: var(--cr-r-grande, 18px);
    font-family: var(--cr-fuente, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", Inter, Roboto, sans-serif); color: var(--txt); }
  @media (prefers-color-scheme: dark) { :host { --sup: var(--cr-superficie, #1c1c1e); --fondo: var(--cr-fondo, #000); --txt: var(--cr-texto, #f5f5f7); --txt2: var(--cr-texto-2, #98989d); --borde: var(--cr-borde, rgba(255,255,255,.12)); --a: var(--cr-acento, #3b8bff); } }
  :host-context([data-cr-tema="oscuro"]) { --sup: var(--cr-superficie, #1c1c1e); --fondo: var(--cr-fondo, #000); --txt: var(--cr-texto, #f5f5f7); --txt2: var(--cr-texto-2, #98989d); --borde: var(--cr-borde, rgba(255,255,255,.12)); }
  button { font: inherit; }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
`
let DATOS = null
let OPCIONES = {}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

class AccesoEscritorio extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    const r = this.attachShadow({ mode: 'open' })
    const o = OPCIONES
    r.innerHTML = `<style>${ESTILO_BASE}
      .pantalla { min-height: 100vh; display: grid; place-items: center; background: var(--fondo); padding: 24px; box-sizing: border-box; }
      .tarjeta { width: min(400px, 100%); background: var(--sup); border: 1px solid var(--borde); border-radius: var(--r); padding: 34px 30px 28px; box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 20px 50px rgba(0,0,0,.08); animation: entra .45s cubic-bezier(.2,.8,.2,1) both; box-sizing: border-box; }
      @keyframes entra { from { opacity: 0; transform: translateY(10px) scale(.98); } }
      .logo { width: 48px; height: 48px; border-radius: 13px; background: var(--a); color: var(--a-txt); display: grid; place-items: center; font-weight: 700; font-size: 22px; margin-bottom: 18px; overflow: hidden; }
      .logo img { width: 100%; height: 100%; object-fit: cover; }
      h1 { font-size: 24px; letter-spacing: -.02em; margin: 0 0 4px; }
      p.sub { color: var(--txt2); margin: 0 0 24px; font-size: 14.5px; }
      label { display: block; font-size: 13px; font-weight: 600; margin: 0 0 6px; }
      input { width: 100%; box-sizing: border-box; font: inherit; font-size: 15px; padding: 11px 13px; border-radius: 11px; border: 1px solid var(--borde); background: var(--fondo); color: var(--txt); margin-bottom: 14px; transition: border-color .15s, box-shadow .15s; }
      input:focus { outline: none; border-color: var(--a); box-shadow: 0 0 0 4px color-mix(in srgb, var(--a) 18%, transparent); }
      .principal { width: 100%; border: 0; border-radius: 999px; padding: 12px; font-weight: 650; font-size: 15px; background: var(--a); color: var(--a-txt); cursor: pointer; margin-top: 6px; transition: filter .15s, transform .1s; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; }
      .principal:hover { filter: brightness(1.06); } .principal:active { transform: scale(.98); } .principal:disabled { opacity: .6; cursor: default; }
      .giro { width: 16px; height: 16px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: gira .7s linear infinite; }
      @keyframes gira { to { transform: rotate(360deg); } }
      .enlace { background: none; border: 0; color: var(--a); cursor: pointer; padding: 8px 0 0; font-size: 13.5px; font-weight: 600; }
      .mensaje { font-size: 13.5px; border-radius: 10px; padding: 10px 12px; margin: 0 0 14px; }
      .mensaje.error { background: color-mix(in srgb, var(--err) 12%, transparent); color: var(--err); }
      .mensaje.ok { background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok); }
      .pie { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
      .cargando { display: grid; place-items: center; min-height: 100vh; background: var(--fondo); }
      [hidden] { display: none !important; }
    </style>
    <div class="cargando" part="cargando"><div class="giro" style="color: var(--a); width: 26px; height: 26px"></div></div>
    <div class="pantalla" part="pantalla" hidden>
      <form class="tarjeta" novalidate>
        <div class="logo">${o.logo ? `<img src="${esc(o.logo)}" alt="">` : esc((o.titulo || 'A').trim()[0].toUpperCase())}</div>
        <h1>${esc(o.titulo || 'Bienvenido')}</h1>
        <p class="sub" data-sub>${esc(o.subtitulo || 'Inicia sesión para continuar')}</p>
        <div class="mensaje" role="alert" hidden></div>
        <div data-campo-nombre hidden><label for="n">Nombre</label><input id="n" name="nombre" autocomplete="name"></div>
        <label for="c">Correo</label><input id="c" name="correo" type="email" autocomplete="username" required>
        <div data-campo-clave><label for="k">Clave</label><input id="k" name="clave" type="password" autocomplete="current-password" required></div>
        <button class="principal" type="submit"><span data-texto>Entrar</span></button>
        <div class="pie"><button class="enlace" type="button" data-olvide>¿Olvidaste tu clave?</button>${o.registro ? '<button class="enlace" type="button" data-registro>Crear cuenta</button>' : ''}</div>
      </form>
    </div>
    <slot hidden></slot>`
    const $ = (s) => r.querySelector(s)
    const form = $('form'), msg = $('.mensaje'), boton = $('.principal'), textoBoton = $('[data-texto]')
    let modo = 'entrar'
    const mostrarMensaje = (t, tipo = 'error') => { msg.textContent = t; msg.className = `mensaje ${tipo}`; msg.hidden = !t }
    const ponerModo = (m) => {
      modo = m; mostrarMensaje('')
      $('[data-campo-clave]').hidden = m === 'recuperar'
      $('[data-campo-nombre]').hidden = m !== 'registro'
      textoBoton.textContent = { entrar: 'Entrar', recuperar: 'Enviar enlace', registro: 'Crear cuenta' }[m]
      $('[data-sub]').textContent = { entrar: o.subtitulo || 'Inicia sesión para continuar', recuperar: 'Te enviamos un enlace para crear una clave nueva.', registro: 'Crea tu cuenta para entrar.' }[m]
      $('[data-olvide]').textContent = m === 'entrar' ? '¿Olvidaste tu clave?' : 'Volver a entrar'
    }
    $('[data-olvide]').onclick = () => ponerModo(modo === 'entrar' ? 'recuperar' : 'entrar')
    $('[data-registro]')?.addEventListener('click', () => ponerModo(modo === 'registro' ? 'entrar' : 'registro'))
    form.onsubmit = async (ev) => {
      ev.preventDefault()
      const correo = form.correo.value.trim(), clave = form.clave.value
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return mostrarMensaje('Escribe un correo válido.'), form.correo.focus()
      if (modo !== 'recuperar' && clave.length < 6) return mostrarMensaje('La clave debe tener al menos 6 caracteres.'), form.clave.focus()
      boton.disabled = true; textoBoton.innerHTML = '<span class="giro"></span>'
      const r = modo === 'entrar' ? await DATOS.sesion.entrar(correo, clave) : modo === 'recuperar' ? await DATOS.sesion.recuperar(correo) : await DATOS.sesion.registrar(correo, clave, form.nombre.value.trim())
      boton.disabled = false; ponerModoTexto()
      if (!r.ok) return mostrarMensaje(r.error)
      if (modo === 'recuperar') mostrarMensaje('Listo: revisa tu correo.', 'ok')
      if (modo === 'registro') mostrarMensaje('Cuenta creada. Si pide confirmación, revisa tu correo.', 'ok')
    }
    const ponerModoTexto = () => { textoBoton.textContent = { entrar: 'Entrar', recuperar: 'Enviar enlace', registro: 'Crear cuenta' }[modo] }
    let primera = true
    this._parar = DATOS.sesion.alCambiar((usuario) => {
      const cargando = primera && usuario === null && !this._resuelto
      $('.cargando').hidden = !cargando
      $('.pantalla').hidden = cargando || !!usuario
      $('slot').hidden = !usuario
      if (usuario) form.reset()
      this.dispatchEvent(new CustomEvent('sesion', { detail: { usuario, perfil: DATOS.sesion.perfil() }, bubbles: true }))
    })
    // la sesión guardada se resuelve en milisegundos; si no hay, muestra el formulario
    setTimeout(() => { this._resuelto = true; primera = false; if (!DATOS.sesion.usuario()) { $('.cargando').hidden = true; $('.pantalla').hidden = false; setTimeout(() => form.correo.focus(), 50) } }, 350)
  }
  disconnectedCallback() { this._parar?.() }
}

class EstadoConexion extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    const r = this.attachShadow({ mode: 'open' })
    r.innerHTML = `<style>${ESTILO_BASE}
      .chip { display: inline-flex; align-items: center; gap: 7px; padding: 4px 11px 4px 9px; border-radius: 999px; font-size: 12.5px; font-weight: 600; background: color-mix(in srgb, var(--c) 12%, transparent); color: var(--c); transition: background .2s, color .2s; white-space: nowrap; }
      .punto { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
      .reconectando .punto { animation: late 1.1s ease-in-out infinite; } @keyframes late { 50% { opacity: .25; } }
      .conf { margin-left: 6px; border: 0; cursor: pointer; --c: var(--aviso); }
      dialog { border: 1px solid var(--borde); border-radius: var(--r); background: var(--sup); color: var(--txt); padding: 22px; width: min(560px, 92vw); box-shadow: 0 30px 80px rgba(0,0,0,.25); }
      dialog::backdrop { background: rgba(0,0,0,.35); }
      dialog h3 { margin: 0 0 6px; font-size: 17px; } dialog p { margin: 0 0 14px; color: var(--txt2); font-size: 13.5px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 14px; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--borde); } th { color: var(--txt2); font-weight: 600; }
      td.dif { background: color-mix(in srgb, var(--aviso) 12%, transparent); font-weight: 600; }
      .botones { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      .botones button { border-radius: 999px; padding: 8px 15px; font-weight: 600; font-size: 13px; cursor: pointer; border: 1px solid var(--borde); background: transparent; color: var(--txt); }
      .botones button.prim { background: var(--a); color: var(--a-txt); border-color: transparent; }
    </style><span class="chip" role="status" aria-live="polite"><span class="punto"></span><span data-t></span></span><button class="chip conf" type="button" hidden></button><button class="chip conf rech" type="button" hidden style="--c: var(--err)"></button><dialog></dialog>`
    const chip = r.querySelector('.chip'), t = r.querySelector('[data-t]')
    const botonConf = r.querySelector('.conf'), dialogo = r.querySelector('dialog')
    const mostrarConflicto = () => {
      const [c] = DATOS.conflictos?.() || []
      if (!c) return dialogo.close?.()
      const campos = [...new Set([...Object.keys(c.mio), ...Object.keys(c.servidor)])].filter((k) => !['id', 'creado', 'creado_por', 'actualizado'].includes(k))
      dialogo.innerHTML = `<h3>Otro equipo cambió este registro</h3><p>Mientras lo editabas (o sin internet), alguien más guardó cambios en <b>${esc(c.tabla)}</b>. Elige con cuál versión quedarse.</p>
        <table><thead><tr><th>Campo</th><th>Tu versión</th><th>En la base</th></tr></thead><tbody>${campos.map((k) => `<tr><td>${esc(k)}</td><td class="${String(c.mio[k]) !== String(c.servidor[k]) ? 'dif' : ''}">${esc(c.mio[k] ?? '—')}</td><td class="${String(c.mio[k]) !== String(c.servidor[k]) ? 'dif' : ''}">${esc(c.servidor[k] ?? '—')}</td></tr>`).join('')}</tbody></table>
        <div class="botones"><button type="button" data-e="servidor">Quedarme con la de la base</button><button type="button" class="prim" data-e="mio">Guardar la mía</button></div>`
      dialogo.querySelectorAll('[data-e]').forEach((b) => (b.onclick = async () => { await DATOS.resolverConflicto(0, b.dataset.e); if (DATOS.conflictos().length) mostrarConflicto(); else dialogo.close() }))
      if (!dialogo.open) dialogo.showModal()
    }
    botonConf.onclick = mostrarConflicto
    const botonRech = r.querySelector('.rech')
    const mostrarRechazos = () => {
      const l = DATOS.rechazados?.() || []
      if (!l.length) return dialogo.close?.()
      dialogo.innerHTML = `<h3>Cambios que la base no aceptó</h3><p>Se guardaron en este equipo (quizás sin internet) pero al subirlos la base los rechazó. Puedes reintentar (por ejemplo, si ya te dieron el permiso) o descartarlos.</p>
        <table><thead><tr><th>Qué</th><th>Motivo</th><th></th></tr></thead><tbody>${l.map((x, i) => `<tr><td>${x.op.tipo === 'borrar' ? 'Borrar' : 'Guardar'} en <b>${esc(x.op.tabla)}</b><br><small>${esc(new Date(x.en).toLocaleString())}</small></td><td>${esc(x.error)}</td><td style="white-space:nowrap"><div class="botones"><button type="button" data-r="${i}">Reintentar</button><button type="button" data-d="${i}">Descartar</button></div></td></tr>`).join('')}</tbody></table>
        <div class="botones"><button type="button" data-c>Cerrar</button></div>`
      dialogo.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => { DATOS.reintentarRechazo(Number(b.dataset.r)); setTimeout(mostrarRechazos, 300) }))
      dialogo.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => { DATOS.descartarRechazo(Number(b.dataset.d)); mostrarRechazos() }))
      dialogo.querySelector('[data-c]').onclick = () => dialogo.close()
      if (!dialogo.open) dialogo.showModal()
    }
    botonRech.onclick = mostrarRechazos
    this._pararRech = DATOS.alRechazo?.((l) => { botonRech.hidden = !l.length; botonRech.textContent = `✕ ${l.length} sin subir` })
    this._pararConf = DATOS.alConflicto?.((l) => { botonConf.hidden = !l.length; botonConf.textContent = `⚠ ${l.length} conflicto${l.length === 1 ? '' : 's'}` })
    this._parar = DATOS.alCambiarConexion(({ estado, pendientes }) => {
      const p = pendientes ? ` · ${pendientes} cambio${pendientes === 1 ? '' : 's'} por subir` : ''
      chip.className = `chip ${estado}`
      chip.style.setProperty('--c', estado === 'en-linea' ? (pendientes ? 'var(--aviso)' : 'var(--ok)') : estado === 'reconectando' ? 'var(--aviso)' : 'var(--err)')
      t.textContent = (estado === 'en-linea' ? (pendientes ? 'Subiendo cambios' : 'En línea') : estado === 'reconectando' ? 'Reconectando…' : 'Sin conexión') + p
      this.dataset.estado = estado
    })
  }
  disconnectedCallback() { this._parar?.(); this._pararConf?.(); this._pararRech?.() }
}

class UsuarioEscritorio extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    const r = this.attachShadow({ mode: 'open' })
    r.innerHTML = `<style>${ESTILO_BASE}
      .caja { display: inline-flex; align-items: center; gap: 10px; }
      .ini { width: 32px; height: 32px; border-radius: 50%; background: var(--a); color: var(--a-txt); display: grid; place-items: center; font-weight: 700; font-size: 13px; }
      .nom { font-size: 13.5px; font-weight: 600; line-height: 1.2; } .rol { font-size: 12px; color: var(--txt2); }
      button { border: 1px solid var(--borde); background: transparent; color: var(--txt); border-radius: 999px; padding: 5px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
      button:hover { background: color-mix(in srgb, var(--txt) 6%, transparent); }
    </style><div class="caja" hidden><span class="ini"></span><span><div class="nom"></div><div class="rol"></div></span><button type="button">Salir</button></div>`
    const caja = r.querySelector('.caja')
    r.querySelector('button').onclick = () => DATOS.sesion.salir()
    this._parar = DATOS.sesion.alCambiar((u, perfil) => {
      caja.hidden = !u
      if (!u) return
      const nombre = perfil?.nombre || u.email.split('@')[0]
      r.querySelector('.ini').textContent = nombre.trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()
      r.querySelector('.nom').textContent = nombre
      const extra = Object.entries(perfil || {}).filter(([k, v]) => !['id', 'nombre', 'rol', 'creado'].includes(k) && v).map(([, v]) => v)
      r.querySelector('.rol').textContent = [perfil?.rol === 'admin' ? 'Administrador' : 'Usuario', ...extra].join(' · ')
    })
  }
  disconnectedCallback() { this._parar?.() }
}

const ACCIONES = [['leer', 'Ver'], ['crear', 'Crear'], ['cambiar', 'Cambiar'], ['borrar', 'Borrar']]
const fechaCorta = (iso) => (iso ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—')
const claveSugerida = () => { const c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const a = new Uint32Array(12); crypto.getRandomValues(a); return [...a].map((x) => c[x % c.length]).join('') }

class AdminUsuarios extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return
    this.r = this.attachShadow({ mode: 'open' })
    this.pestana = 'usuarios'
    this.usuarios = []; this.roles = []; this.corridas = []; this.autos = []
    this.rolElegido = null; this.nuevo = false; this.mensaje = null
    this._parar = DATOS.sesion.alCambiar(() => this.cargar())
  }
  disconnectedCallback() { this._parar?.() }
  get tablas() { return OPCIONES.tablas || [] }
  get campos() { return OPCIONES.camposPerfil || [] }
  avisar(texto, tipo = 'ok') { this.mensaje = { texto, tipo }; this.pintar(); clearTimeout(this._t); this._t = setTimeout(() => { this.mensaje = null; this.pintar() }, tipo === 'ok' ? 2600 : 6000) }
  async cargar() {
    if (!DATOS.sesion.usuario() || !DATOS.sesion.gestionaUsuarios()) return this.pintar()
    const [u, r, c, a, errores, cambios, migraciones, minima] = await Promise.all([DATOS.admin.usuarios.listar(), DATOS.admin.roles.listar(), DATOS.admin.corridas(60), window.escritorio?.automatizaciones?.lista?.().catch(() => []) ?? [],
      DATOS.admin.errores?.(60) ?? {}, DATOS.admin.auditoria?.({ limite: 80 }) ?? {}, DATOS.admin.migraciones?.() ?? {}, DATOS.admin.versionMinima?.leer().catch(() => null) ?? null])
    this.sistema = { errores: errores.errores || [], cambios: cambios.cambios || [], migraciones: migraciones.migraciones || [], minima }
    if (u.ok) this.usuarios = u.usuarios; else this.mensaje = { texto: u.error, tipo: 'error' }
    if (r.ok) this.roles = r.roles
    if (c.ok) this.corridas = c.corridas
    this.autos = a || []
    if (!this.rolElegido || !this.roles.find((x) => x.nombre === this.rolElegido.nombre)) this.rolElegido = this.roles.find((x) => x.nombre !== 'admin') ? structuredClone(this.roles.find((x) => x.nombre !== 'admin')) : null
    this.pintar()
  }
  pintar() {
    const r = this.r
    const puede = DATOS.sesion.usuario() && DATOS.sesion.gestionaUsuarios()
    const soyAdmin = DATOS.sesion.esAdmin()
    const valores = OPCIONES.valores || {}
    const campoInput = (c, valor, extra = '') => valores[c]?.length
      ? `<select data-campo="${esc(c)}" ${extra}><option value="">—</option>${valores[c].map((v) => `<option ${v === valor ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`
      : `<input data-campo="${esc(c)}" value="${esc(valor || '')}" placeholder="${esc(c)}" ${extra}>`
    const rolesAsignables = this.roles.filter((x) => soyAdmin || x.nombre !== 'admin')
    r.innerHTML = `<style>${ESTILO_BASE}
      :host { display: block; }
      .caja { background: var(--sup); border: 1px solid var(--borde); border-radius: var(--r); overflow: hidden; }
      .cab { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--borde); flex-wrap: wrap; }
      h2 { font-size: 18px; margin: 0; letter-spacing: -.01em; }
      .tabs { display: inline-flex; background: color-mix(in srgb, var(--txt) 6%, transparent); border-radius: 999px; padding: 3px; }
      .tabs button { border: 0; background: transparent; color: var(--txt2); padding: 6px 14px; border-radius: 999px; font-weight: 600; font-size: 13px; cursor: pointer; }
      .tabs button[aria-selected=true] { background: var(--sup); color: var(--txt); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
      .cuerpo { padding: 14px 18px 18px; }
      table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
      th { text-align: left; font-size: 12px; color: var(--txt2); font-weight: 600; padding: 8px 8px; border-bottom: 1px solid var(--borde); }
      td { padding: 9px 8px; border-bottom: 1px solid var(--borde); vertical-align: middle; }
      tr.inactivo td { opacity: .5; }
      .quien b { display: block; font-weight: 600; } .quien span { color: var(--txt2); font-size: 12.5px; }
      select, input:not([type=checkbox]) { font: inherit; font-size: 13px; padding: 6px 9px; border-radius: 9px; border: 1px solid var(--borde); background: var(--fondo); color: var(--txt); max-width: 170px; }
      .btn { border: 1px solid var(--borde); background: transparent; color: var(--txt); border-radius: 999px; padding: 6px 13px; font-weight: 600; font-size: 12.5px; cursor: pointer; white-space: nowrap; }
      .btn.prim { background: var(--a); color: var(--a-txt); border-color: transparent; }
      .btn.peligro { color: var(--err); border-color: color-mix(in srgb, var(--err) 40%, transparent); }
      .btn:disabled { opacity: .45; cursor: default; }
      .interruptor { position: relative; width: 38px; height: 22px; border-radius: 999px; background: color-mix(in srgb, var(--txt) 18%, transparent); border: 0; cursor: pointer; transition: background .2s; }
      .interruptor::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .2s; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
      .interruptor[aria-checked=true] { background: var(--ok); } .interruptor[aria-checked=true]::after { transform: translateX(16px); }
      .form { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; align-items: end; padding: 14px; border: 1px dashed var(--borde); border-radius: 14px; margin-bottom: 14px; }
      .form label { font-size: 12px; font-weight: 600; color: var(--txt2); display: grid; gap: 4px; } .form input, .form select { max-width: none; width: 100%; box-sizing: border-box; }
      .msg { margin: 0 0 12px; padding: 9px 12px; border-radius: 10px; font-size: 13px; }
      .msg.ok { background: color-mix(in srgb, var(--ok) 12%, transparent); color: var(--ok); } .msg.error { background: color-mix(in srgb, var(--err) 12%, transparent); color: var(--err); }
      .roles { display: grid; grid-template-columns: 190px 1fr; gap: 18px; }
      .lista-roles button { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 9px 11px; border-radius: 10px; color: var(--txt); font-weight: 600; font-size: 13.5px; cursor: pointer; }
      .lista-roles button[aria-current=true] { background: color-mix(in srgb, var(--a) 12%, transparent); color: var(--a); }
      .lista-roles small { display: block; color: var(--txt2); font-weight: 500; font-size: 12px; }
      .matriz td, .matriz th { text-align: center; } .matriz td:first-child, .matriz th:first-child { text-align: left; }
      input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--a); }
      .autos { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 6px; font-size: 13px; } .autos label { display: inline-flex; gap: 6px; align-items: center; }
      h3 { font-size: 13px; color: var(--txt2); margin: 18px 0 6px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; }
      .chip { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; }
      .chip.ok { background: color-mix(in srgb, var(--ok) 13%, transparent); color: var(--ok); } .chip.mal { background: color-mix(in srgb, var(--err) 12%, transparent); color: var(--err); }
      .vacio { color: var(--txt2); padding: 24px 0; text-align: center; }
      @media (max-width: 760px) { .roles { grid-template-columns: 1fr; } .oculto-movil { display: none; } }
    </style>
    <div class="caja">
      <div class="cab"><h2>Usuarios y roles</h2>${puede ? `<div class="tabs" role="tablist">${[['usuarios', 'Usuarios'], ['roles', 'Roles y permisos'], ['actividad', 'Actividad'], ['sistema', 'Sistema']].map(([k, v]) => `<button role="tab" data-tab="${k}" aria-selected="${this.pestana === k}">${v}</button>`).join('')}</div>` : ''}</div>
      <div class="cuerpo">
      ${this.mensaje ? `<div class="msg ${this.mensaje.tipo}" role="status">${esc(this.mensaje.texto)}</div>` : ''}
      ${!puede ? '<div class="vacio">Tu rol no puede administrar usuarios.</div>'
        : this.pestana === 'usuarios' ? `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><span style="color:var(--txt2);font-size:13px">${this.usuarios.length} usuario${this.usuarios.length === 1 ? '' : 's'}</span><button class="btn prim" data-accion="nuevo">${this.nuevo ? 'Cancelar' : '+ Nuevo usuario'}</button></div>
        ${this.nuevo ? `<form class="form" data-form="nuevo">
          <label>Nombre<input name="nombre" required></label>
          <label>Correo<input name="correo" type="email" required></label>
          <label>Clave inicial<input name="clave" value="${claveSugerida()}" required minlength="8"></label>
          <label>Rol<select name="rol">${rolesAsignables.map((x) => `<option ${x.nombre === 'usuario' ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></label>
          ${this.campos.map((c) => `<label>${esc(c[0].toUpperCase() + c.slice(1))}${campoInput(c, '', `name="campo-${esc(c)}"`)}</label>`).join('')}
          <button class="btn prim" type="submit">Crear usuario</button>
        </form>` : ''}
        <table><thead><tr><th>Usuario</th><th>Rol</th>${this.campos.map((c) => `<th>${esc(c[0].toUpperCase() + c.slice(1))}</th>`).join('')}<th>Activo</th><th class="oculto-movil">Último ingreso</th><th></th></tr></thead><tbody>
        ${this.usuarios.map((u) => { const bloqueado = (u.rol === 'admin' && !soyAdmin); return `<tr data-id="${esc(u.id)}" class="${u.activo ? '' : 'inactivo'}">
          <td class="quien"><b>${esc(u.nombre || '—')}${u.soyYo ? ' (tú)' : ''}</b><span>${esc(u.correo || '')}</span></td>
          <td><select data-rol ${u.soyYo || bloqueado ? 'disabled' : ''}>${(bloqueado ? this.roles : rolesAsignables).map((x) => `<option ${x.nombre === u.rol ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></td>
          ${this.campos.map((c) => `<td>${campoInput(c, u[c], bloqueado ? 'disabled' : '')}</td>`).join('')}
          <td><button class="interruptor" role="switch" aria-label="Activo" aria-checked="${!!u.activo}" data-activo ${u.soyYo || bloqueado ? 'disabled' : ''}></button></td>
          <td class="oculto-movil" style="color:var(--txt2)">${fechaCorta(u.ultimoIngreso)}</td>
          <td style="text-align:right;white-space:nowrap">${bloqueado ? '' : `<button class="btn" data-accion="clave">Nueva clave</button>${soyAdmin && !u.soyYo ? ` <button class="btn peligro" data-accion="borrar">${this.confirmar === u.id ? '¿Seguro?' : 'Borrar'}</button>` : ''}`}</td>
        </tr>` }).join('')}
        </tbody></table>`
        : this.pestana === 'roles' ? this.pintarRoles(soyAdmin)
        : this.pestana === 'sistema' ? this.pintarSistema(soyAdmin)
        : `${this.corridas.length ? `<table><thead><tr><th>Cuándo</th><th>Automatización</th><th>Equipo</th><th>Resultado</th></tr></thead><tbody>${this.corridas.map((c) => `<tr><td>${fechaCorta(c.fin)}</td><td>${esc(c.nombre || c.automatizacion)}</td><td>${esc(c.equipo || '')}</td><td>${c.ok ? '<span class="chip ok">Bien</span>' : `<span class="chip mal">Falló</span> <span style="color:var(--txt2);font-size:12.5px">${esc((c.error || '').slice(0, 120))}</span>`}</td></tr>`).join('')}</tbody></table>` : '<div class="vacio">Todavía no hay corridas de automatizaciones.</div>'}`}
      </div>
    </div>`
    this.conectar()
  }
  pintarSistema(soyAdmin) {
    const s = this.sistema || {}
    const nombreDe = (id) => this.usuarios.find((u) => u.id === id)?.nombre || (id ? 'Usuario borrado' : 'Sistema')
    const resumenCambio = (c) => {
      if (c.accion === 'insert') return 'creó el registro'
      if (c.accion === 'delete') return 'borró el registro'
      const cambiados = Object.keys(c.despues || {}).filter((k) => k !== 'actualizado' && JSON.stringify(c.despues[k]) !== JSON.stringify(c.antes?.[k]))
      return cambiados.map((k) => `${k}: ${esc(c.antes?.[k] ?? '—')} → <b>${esc(c.despues[k] ?? '—')}</b>`).join(' · ')
    }
    return `
      <h3 style="margin-top:4px">Versión mínima de la app</h3>
      <p style="color:var(--txt2);font-size:13px;margin:0 0 8px">Los equipos con una versión menor se bloquean y piden actualizar, y la base no les deja guardar. Úsala cuando cambies la base de datos.</p>
      <form data-form="minima" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><input name="minima" value="${esc(s.minima || '')}" placeholder="Sin mínima (ej. 1.3.0)" ${soyAdmin ? '' : 'disabled'} aria-label="Versión mínima">${soyAdmin ? '<button class="btn prim">Guardar</button>' : ''}</form>
      <h3>Errores en los equipos</h3>
      ${s.errores?.length ? `<table><thead><tr><th>Cuándo</th><th>Equipo</th><th>Versión</th><th>Dónde</th><th>Error</th></tr></thead><tbody>${s.errores.slice(0, 40).map((e) => `<tr><td>${fechaCorta(e.creado)}</td><td>${esc(e.equipo || '')}</td><td>${esc(e.version || '')}</td><td>${esc(e.origen || '')}</td><td title="${esc(e.detalle || '')}">${esc(e.mensaje)}</td></tr>`).join('')}</tbody></table>` : '<div class="vacio" style="padding:12px 0">Sin errores reportados. 🎉</div>'}
      <h3>Historial de cambios</h3>
      ${s.cambios?.length ? `<table><thead><tr><th>Cuándo</th><th>Quién</th><th>Equipo</th><th>Tabla</th><th>Qué</th></tr></thead><tbody>${s.cambios.slice(0, 60).map((c) => `<tr><td>${fechaCorta(c.cuando)}</td><td>${esc(nombreDe(c.usuario))}</td><td>${esc(c.equipo || '')}</td><td>${esc(c.tabla)}</td><td>${resumenCambio(c)}</td></tr>`).join('')}</tbody></table>` : '<div class="vacio" style="padding:12px 0">Todavía no hay cambios registrados.</div>'}
      <h3>Migraciones de la base aplicadas</h3>
      ${s.migraciones?.length ? `<table><tbody>${s.migraciones.map((m) => `<tr><td>${esc(m.nombre)}</td><td style="color:var(--txt2)">${esc(m.resumen || '')}</td><td>${fechaCorta(m.aplicada)}</td></tr>`).join('')}</tbody></table>` : '<div class="vacio" style="padding:12px 0">Sin migraciones registradas.</div>'}`
  }
  pintarRoles(soyAdmin) {
    const rol = this.rolElegido
    const conSede = (t) => t.sede || t.columnaAcceso
    return `<div class="roles">
      <div class="lista-roles">${this.roles.map((x) => `<button data-rol-elegir="${esc(x.nombre)}" aria-current="${rol?.nombre === x.nombre}">${esc(x.nombre)}<small>${esc(x.descripcion || (x.nombre === 'admin' ? 'Todo' : ''))}</small></button>`).join('')}
        ${soyAdmin ? '<form data-form="rol" style="margin-top:10px;display:flex;gap:6px"><input name="nombre" placeholder="Nuevo rol" aria-label="Nombre del rol nuevo" style="flex:1;max-width:none;min-width:0"><button class="btn">+</button></form>' : ''}</div>
      <div>${!rol ? '<div class="vacio">Elige un rol.</div>' : rol.nombre === 'admin' ? '<div class="vacio">El administrador puede todo: datos, usuarios, roles y automatizaciones.</div>' : `
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="font-size:16px">${esc(rol.nombre)}</b><input data-desc value="${esc(rol.descripcion || '')}" placeholder="Descripción" style="flex:1;max-width:none" ${soyAdmin ? '' : 'disabled'}></div>
        <h3>Datos</h3>
        <table class="matriz"><thead><tr><th>Tabla</th>${ACCIONES.map(([, v]) => `<th>${v}</th>`).join('')}<th>Alcance</th></tr></thead><tbody>
        ${this.tablas.map((t) => { const p = rol.permisos?.[t.nombre] || { acciones: [], alcance: 'todo' }; return `<tr data-tabla="${esc(t.nombre)}"><td>${esc(t.etiqueta || t.nombre)}</td>${ACCIONES.map(([k]) => `<td><input type="checkbox" data-accion-permiso="${k}" ${p.acciones?.includes(k) ? 'checked' : ''} ${soyAdmin ? '' : 'disabled'} aria-label="${k} ${esc(t.nombre)}"></td>`).join('')}
          <td><select data-alcance ${soyAdmin ? '' : 'disabled'}><option value="todo" ${p.alcance === 'todo' ? 'selected' : ''}>Todo</option>${conSede(t) ? `<option value="sede" ${p.alcance === 'sede' ? 'selected' : ''}>Su ${esc(conSede(t) === true ? 'sede' : conSede(t))}</option>` : ''}<option value="propio" ${p.alcance === 'propio' ? 'selected' : ''}>Lo suyo</option></select></td></tr>` }).join('')}
        </tbody></table>
        <h3>Automatizaciones que puede ejecutar</h3>
        <div class="autos"><label><input type="checkbox" data-auto="*" ${rol.automatizaciones?.includes('*') ? 'checked' : ''} ${soyAdmin ? '' : 'disabled'}>Todas</label>
          ${this.autos.map((a) => `<label><input type="checkbox" data-auto="${esc(a.id)}" ${rol.automatizaciones?.includes(a.id) ? 'checked' : ''} ${soyAdmin && !rol.automatizaciones?.includes('*') ? '' : 'disabled'}>${esc(a.nombre)}</label>`).join('') || '<span style="color:var(--txt2)">Esta app no tiene automatizaciones.</span>'}</div>
        <h3>Usuarios</h3>
        <label class="autos"><input type="checkbox" data-gestiona ${rol.gestiona_usuarios ? 'checked' : ''} ${soyAdmin ? '' : 'disabled'}>Puede crear y administrar usuarios (no administradores)</label>
        ${soyAdmin ? `<div style="display:flex;gap:8px;margin-top:18px"><button class="btn prim" data-accion="guardar-rol">Guardar cambios</button><button class="btn peligro" data-accion="borrar-rol">${this.confirmar === `rol:${rol.nombre}` ? '¿Seguro?' : 'Borrar rol'}</button></div>` : '<p style="color:var(--txt2);font-size:13px">Solo un administrador puede cambiar roles.</p>'}`}
      </div></div>`
  }
  conectar() {
    const r = this.r
    r.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { this.pestana = b.dataset.tab; this.pintar() }))
    r.querySelector('[data-accion=nuevo]')?.addEventListener('click', () => { this.nuevo = !this.nuevo; this.pintar() })
    r.querySelector('[data-form=minima]')?.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const v = ev.target.minima.value.trim()
      const res = await DATOS.admin.versionMinima.fijar(v || null)
      this.avisar(res.ok ? (v ? `Desde ahora se exige la versión ${v} o superior` : 'Sin versión mínima') : res.error, res.ok ? 'ok' : 'error'); if (res.ok) this.cargar()
    })
    r.querySelector('[data-form=nuevo]')?.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = ev.target
      const campos = Object.fromEntries(this.campos.map((c) => [c, f[`campo-${c}`]?.value || null]))
      const res = await DATOS.admin.usuarios.crear({ nombre: f.nombre.value.trim(), correo: f.correo.value.trim(), clave: f.clave.value, rol: f.rol.value, campos })
      if (!res.ok) return this.avisar(res.error, 'error')
      this.nuevo = false; this.avisar(`Usuario creado. Clave inicial: ${f.clave.value}`); this.cargar()
    })
    r.querySelectorAll('tr[data-id]').forEach((tr) => {
      const id = tr.dataset.id
      const guardar = async (cambios, texto) => { const res = await DATOS.admin.usuarios.actualizar(id, cambios); if (!res.ok) { this.avisar(res.error, 'error'); return this.cargar() } this.avisar(texto); this.cargar() }
      tr.querySelector('[data-rol]').onchange = (e) => guardar({ rol: e.target.value }, 'Rol actualizado')
      tr.querySelectorAll('[data-campo]').forEach((el) => (el.onchange = () => guardar({ campos: { [el.dataset.campo]: el.value || null } }, 'Guardado')))
      tr.querySelector('[data-activo]').onclick = (e) => guardar({ activo: e.currentTarget.getAttribute('aria-checked') !== 'true' }, 'Estado actualizado')
      tr.querySelector('[data-accion=clave]')?.addEventListener('click', async () => {
        const clave = claveSugerida(); const res = await DATOS.admin.usuarios.cambiarClave(id, clave)
        this.avisar(res.ok ? `Clave nueva para ${this.usuarios.find((u) => u.id === id)?.correo}: ${clave}` : res.error, res.ok ? 'ok' : 'error')
      })
      tr.querySelector('[data-accion=borrar]')?.addEventListener('click', async () => {
        if (this.confirmar !== id) { this.confirmar = id; return this.pintar() }
        this.confirmar = null; const res = await DATOS.admin.usuarios.borrar(id); this.avisar(res.ok ? 'Usuario borrado' : res.error, res.ok ? 'ok' : 'error'); this.cargar()
      })
    })
    r.querySelectorAll('[data-rol-elegir]').forEach((b) => (b.onclick = () => { this.rolElegido = structuredClone(this.roles.find((x) => x.nombre === b.dataset.rolElegir)); this.confirmar = null; this.pintar() }))
    r.querySelector('[data-form=rol]')?.addEventListener('submit', async (ev) => {
      ev.preventDefault(); const nombre = ev.target.nombre.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_')
      if (!nombre) return
      if (this.roles.find((x) => x.nombre === nombre)) return this.avisar('Ese rol ya existe', 'error')
      const res = await DATOS.admin.roles.guardar({ nombre, permisos: {}, automatizaciones: [] })
      if (!res.ok) return this.avisar(res.error, 'error')
      await this.cargar(); this.rolElegido = structuredClone(this.roles.find((x) => x.nombre === nombre)); this.avisar(`Rol "${nombre}" creado: marca sus permisos`)
    })
    const rol = this.rolElegido
    if (rol) {
      r.querySelectorAll('tr[data-tabla]').forEach((tr) => {
        const t = tr.dataset.tabla
        const actual = () => (rol.permisos ||= {})[t] ||= { acciones: [], alcance: 'todo' }
        tr.querySelectorAll('[data-accion-permiso]').forEach((cb) => (cb.onchange = () => { const p = actual(); const a = cb.dataset.accionPermiso; p.acciones = cb.checked ? [...new Set([...p.acciones, a, ...(a !== 'leer' ? ['leer'] : [])])] : p.acciones.filter((x) => x !== a && !(a === 'leer')); this.pintar() }))
        tr.querySelector('[data-alcance]').onchange = (e) => { actual().alcance = e.target.value }
      })
      r.querySelectorAll('[data-auto]').forEach((cb) => (cb.onchange = () => { const s = new Set(rol.automatizaciones || []); cb.checked ? s.add(cb.dataset.auto) : s.delete(cb.dataset.auto); rol.automatizaciones = [...s]; this.pintar() }))
      const g = r.querySelector('[data-gestiona]'); if (g) g.onchange = () => { rol.gestiona_usuarios = g.checked }
      const d = r.querySelector('[data-desc]'); if (d) d.oninput = () => { rol.descripcion = d.value }
      r.querySelector('[data-accion=guardar-rol]')?.addEventListener('click', async () => {
        for (const [k, p] of Object.entries(rol.permisos || {})) if (!p.acciones.length) delete rol.permisos[k]
        const res = await DATOS.admin.roles.guardar(rol); this.avisar(res.ok ? `Permisos de "${rol.nombre}" guardados: aplican de inmediato en todos los equipos` : res.error, res.ok ? 'ok' : 'error'); if (res.ok) this.cargar()
      })
      r.querySelector('[data-accion=borrar-rol]')?.addEventListener('click', async () => {
        if (this.confirmar !== `rol:${rol.nombre}`) { this.confirmar = `rol:${rol.nombre}`; return this.pintar() }
        this.confirmar = null; const res = await DATOS.admin.roles.borrar(rol.nombre); this.avisar(res.ok ? 'Rol borrado' : res.error, res.ok ? 'ok' : 'error'); if (res.ok) { this.rolElegido = null; this.cargar() }
      })
    }
  }
}

/**
 * Registra los componentes con tus datos.
 * opciones: { titulo, subtitulo, logo, registro, tablas: [{ nombre, etiqueta, sede }], camposPerfil: ['sede'], valores: { sede: ['Norte', 'Sur'] } }
 */
export function conectarUI(datos, opciones = {}) {
  DATOS = datos
  OPCIONES = opciones
  for (const [n, c] of [['acceso-escritorio', AccesoEscritorio], ['estado-conexion', EstadoConexion], ['usuario-escritorio', UsuarioEscritorio], ['admin-usuarios', AdminUsuarios]]) if (!customElements.get(n)) customElements.define(n, c)
  return datos
}
