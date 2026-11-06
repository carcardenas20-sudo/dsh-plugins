import { analizarDiff, rutasDeArgs, renderCambios, apply } from '../plugins/dsh-traductor-cambios/index.js'
import assert from 'node:assert/strict'
const cfg = { temasAltos: {}, lineasBorradasMedio: 50, archivosMedio: 10 }
const h = {}; const reg = {}
apply({ on: (e, f) => h[e] = f, tools: { register: d => reg[d.name] = d }, systemPrompt: { section() {} }, workingDirectory: {}, get() {} }, {})
const full = { ...cfg, temasAltos: (await import('../plugins/dsh-traductor-cambios/index.js')).analizarDiff && {} }
// usar config por defecto vía un diff realista
const a = analizarDiff('diff --git a/src/ui/boton.tsx b/src/ui/boton.tsx\n--- a/src/ui/boton.tsx\n+++ b/src/ui/boton.tsx\n@@ -1 +1 @@\n-color: azul\n+color: amarillo\n', [], { ...cfg, temasAltos: { pagos: /pago/i } })
assert.equal(a.riesgo, 'bajo'); assert.deepEqual(a.archivos[0], { ruta: 'src/ui/boton.tsx', mas: 1, menos: 1 })
const big = 'diff --git a/x.js b/x.js\n' + Array.from({ length: 60 }, (_, i) => `-linea ${i}`).join('\n')
assert.equal(analizarDiff(big, [], cfg).riesgo, 'medio')
assert.equal(analizarDiff('', ['src/pagos/registrar.ts'], { ...cfg, temasAltos: { pagos: /pago/i } }).riesgo, 'alto')
assert.deepEqual([...rutasDeArgs({ patch: '*** Update File: a.ts\n*** Add File: b/c.ts\n' })], ['a.ts', 'b/c.ts'])
assert.deepEqual([...rutasDeArgs({ file_path: 'z.md' })], ['z.md'])
assert.match(renderCambios([{ fecha: '2026-11-06T10:00:00Z', titulo: 'T', resumen: 'R', impacto: ['i'], riesgo: 'medio', motivo: 'm', como_comprobar: ['c'], archivos: [] }]), /## 🟡 T/)
assert.deepEqual(Object.keys(reg).sort(), ['cambios_registrar', 'cambios_resumen'])
console.log('traductor unit: OK')
