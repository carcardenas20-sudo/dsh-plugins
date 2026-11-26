// Vigila una carpeta: cada CSV de matrículas que llegue se valida, se importa y se archiva.
module.exports = {
  nombre: 'Importar matrículas',
  descripcion: 'Cuando llega un CSV a Documentos/Academia/Entrada lo valida, guarda las matrículas buenas y deja un informe de errores.',
  cuando: { carpeta: '~/Documents/Academia/Entrada', archivos: '*.csv' },

  async ejecutar({ disparo, archivos, estado, registro, interfaz }) {
    // Por carpeta llega un archivo; a mano (o en prueba) procesa todo lo pendiente.
    const pendientes = disparo.tipo === 'carpeta' ? [disparo.archivo] : archivos.listar('~/Documents/Academia/Entrada', '*.csv')
    const matriculas = estado.leer('matriculas', [])
    let buenas = 0, malas = 0
    for (const f of pendientes) {
      const errores = []
      archivos.leerCsv(archivos.leer(f)).forEach((fila, i) => {
        const doc = String(fila.documento || '').replace(/\D/g, '')
        if (doc.length < 6) return errores.push(`fila ${i + 2}: documento inválido "${fila.documento}"`)
        if (!fila.nombre?.trim()) return errores.push(`fila ${i + 2}: falta el nombre`)
        if (!['A2', 'B1', 'C1'].includes(fila.categoria)) return errores.push(`fila ${i + 2}: categoría "${fila.categoria}" no existe`)
        matriculas.push({ documento: doc, nombre: fila.nombre.trim(), categoria: fila.categoria, importada: new Date().toISOString() })
        buenas++
      })
      malas += errores.length
      const nombre = f.split(/[\\/]/).pop()
      archivos.mover(f, `~/Documents/Academia/Procesados/${nombre}`)
      if (errores.length) archivos.escribir(`~/Documents/Academia/Procesados/${nombre}.errores.txt`, errores.join('\n'))
      registro(`${nombre}: ${errores.length ? `${errores.length} con errores` : 'todo bien'}`)
    }
    estado.guardar('matriculas', matriculas)
    interfaz('matriculas-importadas', { buenas, malas, total: matriculas.length })
    return { archivos: pendientes.length, importadas: buenas, conErrores: malas, totalGuardadas: matriculas.length }
  },
}
