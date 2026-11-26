// Copia de seguridad cada 6 horas de los archivos de la Academia.
module.exports = {
  nombre: 'Copia de seguridad',
  descripcion: 'Cada 6 horas copia los consolidados y avisos a Documentos/Academia/Respaldos con la fecha.',
  cuando: { cada: '6h' },

  async ejecutar({ archivos, registro }) {
    const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    let n = 0
    for (const f of archivos.listar('~/Documents/Academia', '*.csv')) {
      archivos.copiar(f, `~/Documents/Academia/Respaldos/${sello}/${f.split(/[\\/]/).pop()}`)
      n++
    }
    registro(`${n} archivos respaldados`)
    return `${n} archivos respaldados`
  },
}
