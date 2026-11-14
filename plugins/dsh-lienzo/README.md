# dsh-lienzo

Páginas visuales de calidad dentro de DeepSeek Harness: recorridos de usuario con maquetas de pantalla, explicaciones, propuestas, comparaciones, hojas de ruta, informes.

El problema que resuelve: si el modelo escribe HTML a mano, cada página sale distinta y con errores (cosas que se salen, texto cortado, gris ilegible, se rompe en el celular). Y como DeepSeek no ve lo que hizo, no se da cuenta.

## Cómo funciona

1. **Kit de diseño.** El agente arma la página con piezas ya diseñadas y probadas:
   - storyboard con maquetas de celular, tablet, monitor o kiosco;
   - pasos, flujo, carriles, línea de tiempo;
   - KPIs, tarjetas, tablas, comparar, pestañas, notas, plegables.

   El plugin pone la tipografía, los colores, el modo oscuro (con botón), la versión para celular y la impresión. Todo queda en un solo `.html` que abre sin internet.
2. **Reglas de diseño.** `lienzo_guia` le enseña al agente a elegir el formato según el contenido. Por ejemplo, un recorrido de usuario va como storyboard y no como una columna de cajas.
3. **Revisión con navegador real.** Cada vez que crea la página, el plugin la abre en el Edge o Chrome que ya tiene el computador, sin ventana y sin instalar nada. La mide a 1280 px (escritorio) y a 390 px (celular), toma capturas en `lienzos/capturas/` y reporta:
   - lo que se sale de la pantalla;
   - texto cortado, desbordado o encimado;
   - contraste bajo y letra muy pequeña;
   - imágenes rotas y errores de JavaScript;
   - recursos de internet;
   - páginas que no usan el kit.
4. **Obliga a corregir.** Si el agente intenta terminar con problemas sin arreglar (o editó la página a mano y la dañó), el plugin vuelve a revisar y le exige corregir, hasta 2 rondas por pedido.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `lienzo_guia` | Reglas de diseño y catálogo de piezas con HTML de ejemplo. |
| `lienzo_crear` | Arma la página en `lienzos/<nombre>.html`, la revisa y devuelve problemas y capturas. |
| `lienzo_revisar` | Vuelve a revisar cualquier `.html` del proyecto. |

Para diagramas con muchas conexiones (arquitectura, base de datos) sigue siendo mejor `visualizar` de dsh-planos.

## Instalar

Harness Desktop: **solo desde la app**, en Plugins → Add plugin:

```
github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-lienzo
```

Perfil web: `dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-lienzo"`

## Configuración opcional

| Opción | Por defecto | Para qué |
|---|---|---|
| `carpeta` | `lienzos` | Dónde se guardan las páginas. |
| `navegador` | automático | Ruta de Edge, Chrome o Chromium si no lo encuentra solo. |
| `rondas` | `2` | Cuántas veces exige corregir por pedido. |
| `capturas` | `true` | Guardar las capturas de escritorio y celular. |
