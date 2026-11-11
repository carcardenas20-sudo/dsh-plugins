# dsh-enrutador

Elige el modelo paso a paso: el económico (Flash) por defecto y el fuerte (V4 Pro) solo cuando hace falta. Lleva la cuenta en dólares y respeta topes.

**Cuándo sube al fuerte**
- El pedido es de diseño, arquitectura o depuración (palabras como "diseña", "refactor", "bug", "no funciona", "por qué").
- Dos fallos seguidos de comandos o herramientas.
- La Prueba de entrega (dsh-prueba-entrega) reporta criterios en rojo.

**Cuándo vuelve al económico**
- Después de 4 pasos del fuerte sin fallos nuevos, al terminar la tarea o al llegar a un tope.

**Imágenes**: DeepSeek-V4.1-Flash ve imágenes; V4-Pro no las declara en dsh 0.2.2. Si la conversación tiene imágenes, el enrutador no sube a Pro (lo indica en `enrutador_estado`). Si tu modelo fuerte sí ve imágenes, pon `fuerteVeImagenes: true`.

**Topes**: por tarea (por defecto $0.50; al llegar avisa al agente para que cierre) y por día ($3; al llegar ya no usa el fuerte). El gasto diario se guarda en `~/.dsh/enrutador-gasto.json`.

El modelo puede consultar `enrutador_estado`: pregúntale "¿cuánto llevo gastado?".

Los costos son estimados con la tabla de precios del plugin (DeepSeek, noviembre 2026, con horario pico ×2). El cobro real está en platform.deepseek.com.

## Configuración (opcional)

```yaml
- id: enrutador
  name: dsh-enrutador
  config:
    fuerte: { provider: deepseek-official, model: deepseek-v4-pro }
    # economico: { provider: deepseek-official, model: deepseek-flash }  # por defecto: el que tengas elegido
    fuerteVeImagenes: false
    erroresParaEscalar: 2
    pasosFuertesMax: 4
    topeTareaUSD: 0.5     # 0 = sin tope
    topeDiarioUSD: 3      # 0 = sin tope
```

Si también usas dsh-prueba-entrega, deja vacío su `modeloEscalado`: el enrutador ya escala cuando la entrega falla.
