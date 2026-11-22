// Colores de marca accesibles a partir de un solo color (hex): texto legible sobre botones,
// texto de acento sobre fondos suaves y variantes para modo oscuro.
const hx = (h) => { const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(h ?? '').trim()); if (!m) return null; let s = m[1]; if (s.length === 3) s = [...s].map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) }
const aHex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')
const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
export const contraste = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
const mezcla = (a, b, p) => a.map((x, i) => x * p + b[i] * (1 - p))
const BLANCO = [255, 255, 255], NEGRO = [0, 0, 0], TINTA = [29, 29, 31], SUP = [255, 255, 255], SUP_OSC = [22, 22, 24]
const textoSobre = (c) => (contraste(BLANCO, c) >= 4.5 || contraste(BLANCO, c) >= contraste(TINTA, c) ? '#ffffff' : '#1d1d1f')

/** Busca la mezcla más cercana al color original que cumpla el contraste pedido. */
function ajustar(base, hacia, contra, minimo, desde = 1) {
  for (let p = desde; p >= 0; p -= 0.02) { const c = mezcla(base, hacia, p); if (contraste(c, contra) >= minimo) return c }
  return hacia
}

export function paletaMarca(color) {
  const base = hx(color)
  if (!base) throw new Error(`"${color}" no es un color hexadecimal (ej. #0b63f6)`)
  const suave = mezcla(base, SUP, 0.11)
  const tinta = ajustar(base, NEGRO, suave, 4.6)
  const oscuro = ajustar(base, BLANCO, SUP_OSC, 4.6, 0.78 + 0.22 * (contraste(base, SUP_OSC) >= 4.6 ? 1 : 0))
  const rellenoOscuro = ajustar(base, BLANCO, SUP_OSC, 2.2)
  const suaveOscuro = mezcla(oscuro, SUP_OSC, 0.11)
  const tintaOscura = ajustar(oscuro, BLANCO, suaveOscuro, 4.6)
  const texto = textoSobre(base)
  const avisos = []
  if (contraste(hx(texto), base) < 4.5) avisos.push(`el texto de los botones primarios queda con contraste ${contraste(hx(texto), base).toFixed(1)}:1 (lo ideal es 4,5:1); un tono un poco más oscuro o más claro de tu color lo resuelve`)
  return {
    base: aHex(base), texto, tinta: aHex(tinta),
    oscuro: aHex(oscuro), rellenoOscuro: aHex(rellenoOscuro), textoOscuro: textoSobre(rellenoOscuro), tintaOscura: aHex(tintaOscura),
    avisos,
  }
}

export const cssMarca = (p) => `/* Color de marca del proyecto (generado por dsh-cristal).
   Para cambiarlo, pídele al agente "cambia el color de marca a #…": recalcula las variantes
   para que el texto siga siendo legible en claro y en oscuro. */
:root {
  --cr-acento-base: ${p.base};
  --cr-acento-texto-claro: ${p.texto};
  --cr-acento-tinta-claro: ${p.tinta};
  --cr-acento-oscuro: ${p.oscuro};
  --cr-acento-relleno-oscuro: ${p.rellenoOscuro};
  --cr-acento-texto-oscuro: ${p.textoOscuro};
  --cr-acento-tinta-oscuro: ${p.tintaOscura};
}
`
