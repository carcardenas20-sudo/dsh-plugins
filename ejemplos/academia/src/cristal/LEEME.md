# Cristal

Sistema de diseño de este proyecto (instalado con dsh-cristal 0.1.0).

| Archivo | Para qué |
|---|---|
| `cristal.css` | Tokens (color, tipografía, espacio, movimiento), componentes, modo oscuro y celular. No lo edites: se reemplaza al actualizar. |
| `marca.css` | El color de marca (#0b63f6) y sus variantes legibles. Este sí es tuyo. |
| `cristal.js` | Hojas, avisos, pestañas, control segmentado, tema y animaciones al hacer scroll. |
| `galeria.html` | Todas las piezas funcionando. Ábrela en el navegador para ver el estilo. |
| `cristal.tailwind.css` | Utilidades de Tailwind v4 con los tokens (bg-superficie, text-texto-2, rounded-cr-grande…). |

## Conexión

En src/index.css, justo después de @import "tailwindcss"; (con layer(components) para que las utilidades de Tailwind puedan ajustar los componentes):
  @import "./cristal/cristal.css" layer(components);
  @import "./cristal/marca.css" layer(components);
  @import "./cristal/cristal.tailwind.css";
En src/main.jsx, con los demás imports:
  import "./cristal/cristal.js"

## Personalizar

- Color de marca: pídele al agente "cambia el color de marca a #…".
- Tus propios estilos: usa siempre las variables `--cr-*` para que funcionen en claro y oscuro.
