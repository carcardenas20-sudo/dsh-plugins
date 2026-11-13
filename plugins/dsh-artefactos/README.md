# dsh-artefactos

Páginas interactivas y bonitas dentro de DeepSeek Harness, que **guardan lo que escribes en el proyecto** para que el agente lo lea.

Le pides al agente, por ejemplo, *"hazme un control de ventas del taller"*, y te entrega una página con:

| Bloque | Qué es |
| --- | --- |
| Formulario | Campos (texto, número, dinero, fecha, opciones, sí/no…) que guardan registros, con tabla, buscador, editar, borrar y totales. |
| Tabla | Tabla editable con fórmulas por fila (cantidad × precio) y totales. |
| Indicadores (KPIs) | Tarjetas con números que se recalculan solos: `suma(ventas.total)`, `contar(ventas)`, `promedio(...)`. |
| Gráfico | Barras, líneas o torta, alimentados por los datos de un formulario o tabla. |
| Calculadora | Entradas y resultados con fórmulas (precio con margen, IVA, cuotas…). |
| Lista | Lista de tareas con progreso. |
| Notas | Texto libre que se guarda. |
| Texto | Instrucciones o explicación. |

Diseño cuidado, claro y oscuro, funciona en el celular, se puede imprimir y usa el color que pidas (por ejemplo, el amarillo de tu marca).

## Cómo funciona

1. El agente crea la página con `artefacto_crear` y te da un enlace `http://127.0.0.1:…`.
2. Ábrelo: en Harness Desktop se abre en el navegador del panel lateral (o en tu navegador). Todo lo que ingresas se guarda solo en `artefactos/<nombre>.datos.json`, dentro del proyecto. Arriba ves "Guardado en el proyecto".
3. Dile al agente *"ya llené el control, analízalo"*: lo lee con `artefacto_leer` en tablas y puede resumir, calcular, comparar o usar los datos en el código.

Si le pides cambios a la página, la vuelve a crear con el mismo nombre y **tus datos se conservan**. `artefacto_abrir` te da el enlace otra vez (cambia cuando reinicias Harness).

También queda el archivo `artefactos/<nombre>.html` para abrir o enviar; abierto así, los datos se guardan solo en ese navegador (con "Exportar datos" e "Importar" los pasas de un lado a otro).

## Seguridad

- El servidor escucha solo en tu PC (`127.0.0.1`), nunca en la red.
- Cada enlace lleva un código secreto, y solo la propia página puede guardar datos: otras páginas web no pueden leerlos ni escribirlos.
- No usa internet ni librerías externas.

## Instalar

En Harness: Plugins → Add plugin →
```
github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-artefactos
```

## Configuración (opcional)

| Clave | Por defecto | Qué hace |
| --- | --- | --- |
| `carpeta` | `artefactos` | Carpeta del proyecto donde se guardan. |
| `puerto` | `47821` | Puerto local (si está ocupado, usa otro libre). |
| `maxDatosMB` | `5` | Tamaño máximo de los datos de una página. |

Probado en dsh 0.2.2: el agente creó un control de ventas, se llenó una venta en el navegador, quedó guardada en el proyecto y el agente la leyó en el siguiente mensaje.
