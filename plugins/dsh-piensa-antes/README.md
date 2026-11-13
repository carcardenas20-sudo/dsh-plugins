# dsh-piensa-antes

En tareas grandes, el agente **planea antes de programar**, y un arquitecto revisa el plan.

## Cómo funciona

1. Cuando pides algo grande, el plugin lo detecta. Por ejemplo: crear un módulo o funcionalidad, integrar una API o pasarela, refactorizar, cambiar la base de datos o la arquitectura, hacerlo "desde cero", o un pedido largo.
2. El agente **puede leer y explorar** el código, pero **no puede editar archivos** hasta que escriba un plan con `plan_crear`:
   - el objetivo;
   - los pasos en orden, con los archivos que toca cada uno;
   - los riesgos y cómo evitarlos;
   - las alternativas que consideró;
   - cómo va a probar que funciona.
3. **Un arquitecto revisor (DeepSeek-V4-Pro)** lee el plan y señala huecos: pasos que faltan o en mal orden, archivos que no consideró, riesgos (datos existentes, seguridad, casos borde), una forma más simple o una prueba que no demostraría nada.
4. El agente ajusta el plan y programa siguiéndolo. El plan queda guardado en `.dsh-planes/` del proyecto.

Las tareas pequeñas (cambiar un color, corregir un texto) pasan sin plan. Si escribes "sin plan" o "rápido", también. Si escribes "con plan", lo exige aunque sea pequeña.

**Modo con visto bueno** (opcional, `esperarAprobacion: true`): el agente te muestra el plan y espera tu "dale" antes de tocar código. Si le dices "no, mejor…", ajusta el plan.

## Con los otros plugins

- **dsh-piensa-antes**: piensa bien *antes* de programar.
- **dsh-segunda-opinion**: otro modelo revisa el código *después*.
- **dsh-prueba-entrega**: no entrega sin pruebas que pasen.
- **dsh-memoria**: recuerda las decisiones para la próxima vez.

## Instalar

En Harness: Plugins → Add plugin →
```
github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-piensa-antes
```

## Configuración (opcional)

| Clave | Por defecto | Qué hace |
| --- | --- | --- |
| `revisor.model` | `deepseek-v4-pro` | Modelo que revisa el plan. |
| `revisarPlan` | `true` | Pedir revisión del arquitecto (una por pedido). |
| `esperarAprobacion` | `false` | Esperar tu visto bueno antes de editar. |
| `minCaracteres` | `450` | Pedidos así de largos se tratan como grandes. |
| `carpeta` | `.dsh-planes` | Dónde se guardan los planes. |

Probado en dsh 0.2.2: el agente intentó editar sin plan y fue frenado, hizo el plan, el arquitecto señaló que faltaba validar el NIT, y el código final incluyó esa validación.
