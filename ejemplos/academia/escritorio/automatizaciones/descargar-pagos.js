// Robot: entra a la plataforma de pagos, consulta cada sede, descarga los CSV y arma un consolidado.
module.exports = {
  nombre: 'Descargar pagos de la plataforma',
  descripcion: 'Entra a la plataforma, consulta las tres sedes, descarga los pagos y deja un consolidado en Documentos/Academia.',
  cuando: [{ cron: '0 18 * * 1-5' }, { manual: true }], // lunes a viernes 6 pm, o con el botón
  tiempoMaximo: '5m',
  reintentos: 2, // si la plataforma falla, reintenta a los 30 s y a 1 min
  ponerseAlDia: true, // si el PC estaba apagado a las 6 pm, corre al abrir la app

  async ejecutar({ robot, archivos, estado, registro, progreso, notificar, interfaz, ejecutar, config }) {
    const p = await robot({ sesion: 'plataforma' }) // recuerda el inicio de sesión entre ejecuciones
    await p.goto(config.plataforma)
    if (await p.getByLabel('Usuario').isVisible()) {
      registro('iniciando sesión')
      await p.getByLabel('Usuario').fill(config.usuario)
      await p.getByLabel('Clave').fill(config.clave)
      await p.getByRole('button', { name: 'Entrar' }).click()
    } else registro('sesión recordada: no hizo falta iniciar sesión')
    await p.getByRole('heading', { name: 'Pagos por sede' }).waitFor()

    const sedes = ['Norte', 'Centro', 'Sur']
    const todas = []
    for (const [i, sede] of sedes.entries()) {
      progreso((i / sedes.length) * 100, `Sede ${sede}`)
      await p.getByLabel('Sede').selectOption(sede)
      await p.getByRole('button', { name: 'Consultar' }).click()
      await p.getByRole('cell').first().waitFor() // la tabla carga sola después de un momento
      const archivo = await p.descargar(() => p.getByRole('button', { name: 'Descargar CSV' }).click())
      const filas = archivos.leerCsv(archivos.leer(archivo))
      registro(`${sede}: ${filas.length} pagos`)
      todas.push(...filas.map((f) => ({ ...f, sede, saldo: Number(f.saldo) })))
    }
    progreso(100, 'Consolidando')
    await p.captura('pagos')

    const hoy = new Date().toISOString().slice(0, 10)
    const destino = archivos.escribir(`~/Documents/Academia/pagos-${hoy}.csv`, archivos.csv(todas))
    const vencidos = todas.filter((f) => f.estado === 'Vencido')
    const total = todas.reduce((s, f) => s + f.saldo, 0)
    const antes = estado.leer('vencidos', null)
    estado.guardar('vencidos', vencidos.length)

    interfaz('pagos-actualizados', { total, vencidos: vencidos.length, archivo: destino })
    if (vencidos.length && vencidos.length !== antes) notificar('Pagos vencidos', `${vencidos.length} aprendices tienen saldo vencido.`)
    if (vencidos.length) ejecutar('avisar-vencidos', { vencidos })
    return { pagos: todas.length, total, vencidos: vencidos.length, archivo: destino }
  },
}
