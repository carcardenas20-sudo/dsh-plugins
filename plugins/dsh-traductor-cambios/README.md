# dsh-traductor-cambios

Cada cambio de código queda explicado para alguien que no programa, con un nivel de riesgo.

Cuando el agente termina una tarea que tocó archivos:

1. El plugin compara el proyecto contra cómo estaba al empezar la tarea (con Git; sin Git, usa los archivos que tocó el agente).
2. Calcula un **riesgo mínimo** con reglas fijas: 🔴 alto si toca dinero, precios, impuestos, pagos, facturas, nómina, login, permisos, base de datos o secretos; 🟡 medio si borra muchas líneas o toca muchos archivos; 🟢 bajo en lo demás.
3. Le pide al agente que explique el cambio sin jerga: qué cambia para el usuario, por qué ese riesgo y cómo comprobarlo a mano. El agente puede subir el riesgo, nunca bajarlo.
4. Lo guarda en `.cambios/CAMBIOS.md` (lo más nuevo arriba) y `.cambios/registro.json`.

Pregúntale al agente "¿qué cambió esta semana?" y usará `cambios_resumen`.

Necesita Git instalado para comparar cambios (funciona sin Git, con menos detalle).

## Configuración (opcional)

```yaml
- id: traductor-cambios
  name: dsh-traductor-cambios
  config:
    lineasBorradasMedio: 50
    archivosMedio: 10
    temasAltos:              # se suman a los de fábrica; valor = expresión regular
      remisiones: "remisi"
```
