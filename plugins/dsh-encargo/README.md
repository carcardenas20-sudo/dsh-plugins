# dsh-encargo

Convierte un pedido corto en un **encargo completo**, verifica que se cumpla antes de entregar y aprende de lo que le corriges.

El problema que resuelve: el agente hace lo que dices al pie de la letra y omite lo que no dijiste pero se necesitaba (validaciones, permisos, casos límite, otras pantallas que se afectan).

## Cómo funciona

1. **Amplía el pedido.** Cuando pides construir o cambiar algo, un analista (V4-Pro) lee tu mensaje junto con:
   - la memoria del proyecto (`AGENTS.md`, la que mantiene dsh-memoria);
   - el mapa del sistema (`docs/MAPA-SISTEMA.md`), si existe;
   - los criterios aprendidos del proyecto;
   - la estructura de carpetas.

   Con eso escribe el encargo: lo pedido con precisión, lo que no se dijo pero se necesita, qué más se afecta y una lista de **"está terminado cuando…"**. Si hay una duda que cambia el resultado, hace una sola pregunta.
2. **Te lo resume** al empezar la respuesta. El encargo completo queda en `.dsh-encargo/ultimo.md`.
3. **Verifica al final.** Antes de entregar, un verificador revisa la lista punto por punto contra los cambios reales. Lo que falte, el agente lo completa (hasta 2 rondas por pedido).
4. **Aprende.** Cuando señalas una omisión ("te faltó…"), el agente la guarda como regla general en `.dsh-encargo/criterios.md` y entra en todos los encargos siguientes. Ese archivo se puede editar a mano.

Los mensajes cortos de seguimiento ("dale", "sí") y las preguntas no generan encargo. Para forzarlo escribe **"con encargo"** en el mensaje; para saltarlo, **"sin encargo"**.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `encargo_ver` | Muestra el encargo vigente; con `verificar` comprueba la lista en ese momento. |
| `encargo_criterio` | Agrega, lista o quita criterios del proyecto. |

## Costo

Cada pedido que se amplía hace una llamada extra a V4-Pro al inicio y otra al verificar. Si no quieres ese costo en un pedido, escribe "sin encargo".

## Instalar

Harness Desktop: **solo desde la app**, en Plugins → Add plugin:

```
https://raw.githubusercontent.com/carcardenas20-sudo/dsh-plugins/main/paquetes/dsh-encargo-0.1.0.tgz
```

o `github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-encargo`.

## Configuración opcional

| Opción | Por defecto | Para qué |
|---|---|---|
| `modo` | `auto` | `auto`, `siempre` o `nunca`. |
| `analista.model` | `deepseek-v4-pro` | Modelo que escribe y verifica el encargo. |
| `rondas` | `2` | Veces que devuelve el trabajo por puntos sin cumplir. |
| `contexto` | `AGENTS.md`, `docs/MAPA-SISTEMA.md` | Archivos que lee el analista. |
