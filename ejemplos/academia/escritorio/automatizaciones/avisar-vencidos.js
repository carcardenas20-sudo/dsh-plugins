// Prepara un mensaje por aprendiz con saldo vencido (se encadena después de "descargar-pagos").
module.exports = {
  nombre: 'Preparar avisos de cobro',
  descripcion: 'Escribe un mensaje listo para WhatsApp por cada aprendiz con saldo vencido.',
  cuando: { manual: true },

  async ejecutar({ disparo, archivos, registro }) {
    const vencidos = disparo.datos?.vencidos || []
    if (!vencidos.length) return 'No hay vencidos: nada que avisar.'
    const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    const carpeta = `~/Documents/Academia/avisos/${new Date().toISOString().slice(0, 10)}`
    for (const v of vencidos) {
      const nombre = v.nombre.split(' ')[0]
      archivos.escribir(`${carpeta}/${v.documento}.txt`, `Hola ${nombre}, te escribimos de la Academia. Tu saldo de ${pesos.format(v.saldo)} en la sede ${v.sede} está vencido. ¿Te ayudamos a ponerte al día?`)
      registro(`aviso para ${v.nombre}`)
    }
    return { avisos: vencidos.length, carpeta: archivos.ruta(carpeta) }
  },
}
