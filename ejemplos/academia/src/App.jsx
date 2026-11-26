import { useEffect, useMemo, useState } from "react"
import { LayoutDashboard, Users, CalendarDays, CreditCard, Settings, Menu, Moon, Plus, Inbox } from "lucide-react"

const INICIALES = [
  { id: 1, nombre: "Laura Martínez", documento: "1023456789", curso: "B1", sede: "Norte", estado: "Al día", saldo: 980000 },
  { id: 2, nombre: "Andrés Rojas", documento: "79888123", curso: "A2", sede: "Centro", estado: "Pendiente", saldo: 450000 },
  { id: 3, nombre: "Camila Torres", documento: "1010222333", curso: "C1", sede: "Norte", estado: "Al día", saldo: 1250000 },
  { id: 4, nombre: "Julián Pérez", documento: "1019888777", curso: "B1", sede: "Sur", estado: "Vencido", saldo: 320000 },
]
const CHIP = { "Al día": "ok", Pendiente: "aviso", Vencido: "error" }
const pesos = (n) => "$ " + n.toLocaleString("es-CO")
const ic = { size: 18, strokeWidth: 1.8 }

export default function App() {
  const [cargando, setCargando] = useState(true)
  const [aprendices, setAprendices] = useState([])
  const [buscar, setBuscar] = useState("")
  const [form, setForm] = useState({ nombre: "", documento: "", curso: "B1", sede: "Norte" })
  const [errores, setErrores] = useState({})
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { const t = setTimeout(() => { setAprendices(INICIALES); setCargando(false) }, 700); return () => clearTimeout(t) }, [])
  const filtrados = useMemo(() => aprendices.filter((a) => (a.nombre + a.documento).toLowerCase().includes(buscar.toLowerCase())), [aprendices, buscar])

  function guardar(e) {
    e.preventDefault()
    const err = {}
    if (!form.nombre.trim()) err.nombre = "Escribe el nombre del aprendiz."
    if (!/^\d{6,10}$/.test(form.documento)) err.documento = "El documento debe tener entre 6 y 10 números."
    else if (aprendices.some((a) => a.documento === form.documento)) err.documento = "Ya hay un aprendiz con ese documento."
    setErrores(err)
    if (Object.keys(err).length) return
    setGuardando(true)
    setTimeout(() => {
      const nuevo = { id: Date.now(), ...form, nombre: form.nombre.trim(), estado: "Pendiente", saldo: 0 }
      window.cristal.transicion(() => setAprendices((l) => [nuevo, ...l]))
      setGuardando(false)
      setForm({ nombre: "", documento: "", curso: "B1", sede: "Norte" })
      window.cristal.cerrar("hoja-nuevo")
      window.cristal.aviso(`${nuevo.nombre} quedó registrado`, { tipo: "ok", accion: "Deshacer", alAccion: () => setAprendices((l) => l.filter((a) => a.id !== nuevo.id)) })
    }, 600)
  }
  async function exportar() {
    const csv = "Nombre;Documento;Curso;Sede;Estado;Saldo\n" + aprendices.map((a) => [a.nombre, a.documento, a.curso, a.sede, a.estado, a.saldo].join(";")).join("\n")
    if (window.escritorio) {
      const r = await window.escritorio.archivos.guardar({ nombre: "aprendices.csv", contenido: "\ufeff" + csv, filtros: [{ name: "CSV", extensions: ["csv"] }] })
      if (r) window.cristal.aviso(`Guardado en ${r.nombre}`, { tipo: "ok", accion: "Mostrar", alAccion: () => window.escritorio.archivos.mostrar(r.ruta) })
    } else {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" })); a.download = "aprendices.csv"; a.click()
    }
  }
  const campo = (k) => "cr-campo" + (errores[k] ? " invalido" : "")
  const cambiar = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); if (errores[k]) setErrores({ ...errores, [k]: undefined }) }

  return (
    <div className="cr-app">
      <aside className="cr-lateral" aria-label="Menú">
        <div className="cr-marca"><i />Academia</div>
        <a className="cr-menu-item" href="#"><LayoutDashboard {...ic} />Resumen</a>
        <a className="cr-menu-item" href="#" aria-current="page"><Users {...ic} />Aprendices</a>
        <a className="cr-menu-item" href="#"><CalendarDays {...ic} />Agenda</a>
        <a className="cr-menu-item" href="#"><CreditCard {...ic} />Pagos</a>
        <div className="cr-menu-titulo">Sistema</div>
        <a className="cr-menu-item" href="#"><Settings {...ic} />Ajustes</a>
      </aside>
      <div className="cr-principal">
        <header className="cr-barra">
          <button className="cr-boton icono fantasma cr-solo-celular" data-cr-menu aria-label="Abrir menú"><Menu {...ic} /></button>
          <span className="cr-barra-titulo">Aprendices</span><span className="cr-espacio" />
          <button className="cr-boton icono" data-cr-tema aria-label="Cambiar entre claro y oscuro"><Moon {...ic} /></button>
        </header>
        <main className="cr-pagina">
          <div className="cr-encabezado cr-entra">
            <div><p className="cr-antetitulo">Académico</p><h1>Aprendices</h1><p>{cargando ? "Cargando…" : `${aprendices.length} aprendices en las tres sedes.`}</p></div>
            <button className="cr-boton primario" data-cr-abrir="hoja-nuevo"><Plus {...ic} />Nuevo aprendiz</button>
          </div>

          <div className="cr-rejilla cr-escalonado" style={{ "--min": "150px" }}>
            {[["Activos", aprendices.length], ["Al día", aprendices.filter((a) => a.estado === "Al día").length], ["Con saldo vencido", aprendices.filter((a) => a.estado === "Vencido").length]].map(([e, v]) => (
              <div className="cr-kpi" key={e}><span className="etiqueta">{e}</span>{cargando ? <div className="cr-esqueleto" style={{ height: 37, width: "50%" }} /> : <span className="valor">{v}</span>}</div>
            ))}
          </div>

          <section className="cr-seccion">
            <div className="cr-seccion-cab"><h2>Listado</h2><div className="flex items-center gap-3 w-full max-w-md justify-end"><button className="cr-boton secundario chico" onClick={exportar} disabled={cargando}>Exportar CSV</button><div className="cr-buscador w-full max-w-72"><input className="cr-input" type="search" placeholder="Buscar por nombre o documento" aria-label="Buscar aprendiz" value={buscar} onChange={(e) => setBuscar(e.target.value)} /></div></div></div>
            {cargando ? (
              <div className="cr-tarjeta cr-pila">{[60, 90, 75, 85].map((w) => <div key={w} className="cr-esqueleto" style={{ width: w + "%" }} />)}</div>
            ) : filtrados.length === 0 ? (
              <div className="cr-tarjeta plana cr-vacio"><div className="cr-icono"><Inbox size={24} strokeWidth={1.8} /></div><h3>No hay aprendices con «{buscar}»</h3><p>Revisa el nombre o el documento, o registra un aprendiz nuevo.</p><button className="cr-boton secundario" onClick={() => setBuscar("")}>Limpiar búsqueda</button></div>
            ) : (
              <div className="cr-tabla-caja">
                <table className="cr-tabla">
                  <thead><tr><th>Aprendiz</th><th>Documento</th><th>Curso y sede</th><th>Estado</th><th className="num">Saldo</th></tr></thead>
                  <tbody>{filtrados.map((a) => (
                    <tr key={a.id} style={{ viewTransitionName: "fila-" + a.id }}><td className="principal">{a.nombre}</td><td>{a.documento}</td><td className="text-texto-2">{a.curso} · Sede {a.sede}</td><td><span className={"cr-chip " + CHIP[a.estado]}>{a.estado}</span></td><td className="num">{pesos(a.saldo)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </main>
      </div>

      <dialog className="cr-hoja" id="hoja-nuevo" aria-labelledby="hoja-titulo">
        <form onSubmit={guardar} noValidate style={{ display: "contents" }}>
          <div className="cr-hoja-cab"><h3 id="hoja-titulo">Nuevo aprendiz</h3><button type="button" className="cr-cerrar" data-cr-cerrar aria-label="Cerrar">✕</button></div>
          <div className="cr-hoja-cuerpo">
            <div className={campo("nombre")}><label htmlFor="f-nombre">Nombre completo</label><input className="cr-input" id="f-nombre" value={form.nombre} onChange={cambiar("nombre")} /><span className="error">{errores.nombre}</span></div>
            <div className={campo("documento")}><label htmlFor="f-doc">Documento</label><input className="cr-input" id="f-doc" inputMode="numeric" value={form.documento} onChange={cambiar("documento")} /><span className="error">{errores.documento}</span></div>
            <div className="cr-rejilla" style={{ "--min": "160px" }}>
              <div className="cr-campo"><label htmlFor="f-curso">Curso</label><select className="cr-select" id="f-curso" value={form.curso} onChange={cambiar("curso")}><option>A2</option><option>B1</option><option>C1</option></select></div>
              <div className="cr-campo"><label htmlFor="f-sede">Sede</label><select className="cr-select" id="f-sede" value={form.sede} onChange={cambiar("sede")}><option>Norte</option><option>Centro</option><option>Sur</option></select></div>
            </div>
          </div>
          <div className="cr-hoja-pie"><button type="button" className="cr-boton" data-cr-cerrar>Cancelar</button><button type="submit" className="cr-boton primario" aria-busy={guardando}>Guardar aprendiz</button></div>
        </form>
      </dialog>
    </div>
  )
}
