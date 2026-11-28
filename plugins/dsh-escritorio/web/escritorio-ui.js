// Pantalla de inicio de sesión, usuario y estado de conexión listos (generado por dsh-escritorio).
// Son componentes web: funcionan igual en React, Vue o HTML plano, en la web y en la app de escritorio.
//
//   import { crearDatos } from './datos-en-vivo.js'
//   import { conectarUI } from './escritorio-ui.js'
//   const datos = crearDatos({ url, clave })
//   conectarUI(datos, { titulo: 'Academia', subtitulo: 'Inicia sesión para continuar' })
//
//   <acceso-escritorio>   … toda tu app aquí: solo se muestra con sesión iniciada …   </acceso-escritorio>
//   <estado-conexion></estado-conexion>      "En línea" · "Sin conexión · 3 cambios por subir" · "Reconectando…"
//   <usuario-escritorio></usuario-escritorio> nombre, rol y botón Salir
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
    </style><span class="chip" role="status" aria-live="polite"><span class="punto"></span><span data-t></span></span>`
    const chip = r.querySelector('.chip'), t = r.querySelector('[data-t]')
    this._parar = DATOS.alCambiarConexion(({ estado, pendientes }) => {
      const p = pendientes ? ` · ${pendientes} cambio${pendientes === 1 ? '' : 's'} por subir` : ''
      chip.className = `chip ${estado}`
      chip.style.setProperty('--c', estado === 'en-linea' ? (pendientes ? 'var(--aviso)' : 'var(--ok)') : estado === 'reconectando' ? 'var(--aviso)' : 'var(--err)')
      t.textContent = (estado === 'en-linea' ? (pendientes ? 'Subiendo cambios' : 'En línea') : estado === 'reconectando' ? 'Reconectando…' : 'Sin conexión') + p
      this.dataset.estado = estado
    })
  }
  disconnectedCallback() { this._parar?.() }
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

/** Registra los componentes con tus datos. opciones: { titulo, subtitulo, logo, registro } */
export function conectarUI(datos, opciones = {}) {
  DATOS = datos
  OPCIONES = opciones
  for (const [n, c] of [['acceso-escritorio', AccesoEscritorio], ['estado-conexion', EstadoConexion], ['usuario-escritorio', UsuarioEscritorio]]) if (!customElements.get(n)) customElements.define(n, c)
  return datos
}
