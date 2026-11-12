# dsh-planos

Planos visuales de procesos y plataformas dentro de DeepSeek Harness. Le pides al agente "muéstrame cómo funciona…" y te entrega un HTML con el diagrama, que se abre en el panel lateral de dsh.

Cinco tipos:

| Tipo | Para qué |
| --- | --- |
| `flujo` | Un proceso paso a paso, con carriles por responsable (Cliente, Ventas, Bodega…) y decisiones sí/no. |
| `mapa` | Los módulos y pantallas de la plataforma y cómo se navega entre ellos. |
| `arquitectura` | Capas: usuarios, frontend, backend, base de datos y servicios externos. |
| `datos` | Tablas, campos, llaves (PK/FK) y relaciones. |
| `recorrido` | Lo que hace un usuario paso a paso dentro de la plataforma. |

Cómo trabaja:
- El agente lee primero el código (rutas, modelos, pantallas, migraciones) y dibuja lo que existe. Lo que todavía no existe sale **punteado y marcado como PROPUESTA**.
- Cada elemento tiene su detalle debajo del diagrama (qué hace, dónde está en el código, con qué se conecta). Si tocas un elemento del diagrama, se resaltan sus conexiones.
- El HTML no usa internet ni librerías: se ve igual en dsh, en el navegador o enviado por WhatsApp. Funciona en modo claro y oscuro, y se puede imprimir.
- Para actualizarlo, pide "actualiza el plano": se regenera el mismo archivo.

Los planos quedan en la carpeta `planos/` del proyecto.

## Instalar

```
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-planos"
```

En Harness Desktop, desde Settings → Plugins con el mismo enlace.

## Usar

> Haz un plano del flujo de pedidos de este proyecto, desde que el cliente compra hasta que se despacha.

> Dibuja la arquitectura de la plataforma y marca lo que falta por construir.

> Haz el modelo de datos a partir de las migraciones.

Si el panel muestra el diagrama pero no responde a los clics, activa Coding Tools en Settings: sin eso dsh muestra los HTML sin JavaScript (el diagrama y el detalle igual se ven completos).

## Configuración (opcional)

| Clave | Por defecto | Qué hace |
| --- | --- | --- |
| `carpeta` | `planos` | Carpeta del proyecto donde se guardan. |

Probado en dsh 0.2.2: el agente llamó `visualizar`, el archivo se creó en `planos/`, `present` lo entregó y el panel lateral lo mostró.
