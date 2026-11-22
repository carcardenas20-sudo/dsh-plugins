# dsh-cristal

Interfaces modernas, elegantes y con movimiento dentro de DeepSeek Harness. Claridad, profundidad y animaciones con propósito, en React, HTML o plantillas de Java.

## Qué trae

1. **Sistema de diseño que se instala en tu proyecto** (sin dependencias, sin internet):
   - colores, tipografía del sistema, espacio de 4 px, sombras y vidrio;
   - componentes: barra lateral y barra superior de vidrio, portada, KPIs, tarjetas, listas agrupadas, tablas, formularios con validación animada, interruptores, control segmentado con píldora que se desliza, pestañas, hojas (ventanas) con resorte, avisos con "Deshacer", estados vacío, cargando y error;
   - movimiento: entradas escalonadas, aparición al hacer scroll, respuesta al toque, transiciones entre vistas; todo respeta "reducir movimiento";
   - modo claro y oscuro automáticos, y versión para celular;
   - integración con Tailwind v3 y v4 (`bg-superficie`, `text-texto-2`, `rounded-cr-grande`, `ease-suave`…).
2. **Color de marca accesible.** Le das un color (por ejemplo `#ffd400`) y calcula las variantes para que el texto siempre se lea, en claro y en oscuro.
3. **Reglas de diseño** para el agente: jerarquía, espacio, cuándo usar vidrio, cuánto debe durar cada animación, estados que no pueden faltar.
4. **Revisión en navegador real.** Abre cada pantalla en el Edge o Chrome de tu PC (sin ventana) en escritorio claro, escritorio oscuro y celular, y revisa:
   - lo visual: desbordes, texto cortado o encimado, contraste, letra pequeña, áreas de toque menores a 44 px, errores;
   - el movimiento: animaciones que traban (width, top…), demasiado lentas o infinitas, saltos al cargar, si respeta "reducir movimiento".

   Toma capturas para que el agente las mire y, si quiere entregar sin revisar o con problemas, lo obliga a corregir.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `cristal_instalar` | Instala o actualiza el kit, con el color de marca, y dice cómo conectarlo (React/Vite, Vue, Java/Spring o HTML). |
| `cristal_guia` | Principios de diseño y catálogo de piezas con su código. |
| `cristal_revisar` | Revisa una pantalla (archivo `.html` o `http://localhost:…`). |

Después de instalar, abre `cristal/galeria.html` (o `src/cristal/galeria.html`) en el navegador: muestra todas las piezas funcionando.

## Instalar

Harness Desktop: **solo desde la app**, en Plugins → Add plugin:

```
https://raw.githubusercontent.com/carcardenas20-sudo/dsh-plugins/main/paquetes/dsh-cristal-0.1.1.tgz
```

## Configuración opcional

| Opción | Por defecto | Para qué |
|---|---|---|
| `acento` | `#0b63f6` | Color de marca por defecto. |
| `navegador` | automático | Ruta de Edge o Chrome si no lo encuentra. |
| `rondas` | `2` | Veces que exige corregir por pedido. |
