/* Cristal para Tailwind CSS v3.
   tailwind.config.js:  module.exports = { presets: [require("./src/cristal/cristal.tailwind3.cjs")], content: [...] }
   y en tu CSS principal: @import "./cristal/cristal.css"; (antes de @tailwind base) */
const v = (n) => `var(--cr-${n})`
module.exports = {
  theme: {
    extend: {
      colors: {
        acento: { DEFAULT: v('acento'), suave: v('acento-suave') },
        fondo: v('fondo'), superficie: { DEFAULT: v('superficie'), 2: v('superficie-2') }, hundido: v('hundido'),
        texto: { DEFAULT: v('texto'), 2: v('texto-2'), 3: v('texto-3') }, borde: v('borde'),
        ok: v('ok'), aviso: v('aviso'), error: v('error'),
      },
      fontFamily: { sans: [v('fuente')], titulo: [v('fuente-titulo')] },
      borderRadius: { 'cr-chico': v('r-chico'), cr: v('r'), 'cr-grande': v('r-grande'), 'cr-xl': v('r-xl') },
      boxShadow: { 'cr-1': v('sombra-1'), 'cr-2': v('sombra-2'), 'cr-3': v('sombra-3') },
      transitionTimingFunction: { suave: v('suave'), resorte: v('resorte') },
      transitionDuration: { rapido: '160ms', medio: '280ms', lento: '460ms' },
      animation: { entra: 'cr-entrar 460ms cubic-bezier(.22,1,.36,1) both', revela: 'cr-revelar 460ms cubic-bezier(.22,1,.36,1) both' },
    },
  },
}
