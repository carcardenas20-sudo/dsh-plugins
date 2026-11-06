# dsh-prueba-entrega

Plugin para DeepSeek Harness: el agente no puede decir "listo" sin evidencia.

1. Antes de cambiar código, el agente propone criterios de aceptación en lenguaje claro, cada uno con una verificación objetiva (un comando o un archivo). Tú los apruebas.
2. Cuando el agente intenta cerrar su turno, el plugin ejecuta las verificaciones. Si algo falla, le devuelve los errores y lo obliga a seguir.
3. Si todo pasa, escribe un recibo con la evidencia en `.entrega/recibos/`.
4. Los criterios aprobados quedan en `.entrega/criterios.json` y se verifican en todas las tareas siguientes (regresión).
5. Si hay una meta de dsh (`/goal`), no se puede marcar como completa con un contrato sin verificar.

## Herramientas que ve el modelo

- `entrega_definir` — crea el contrato (pide tu aprobación).
- `entrega_verificar` — corre todo y escribe el recibo.
- `entrega_estado` — muestra el contrato activo.

## Configuración (opcional, en el cordis.patch.yml del perfil)

```yaml
- id: prueba-entrega
  name: dsh-prueba-entrega
  config:
    maxIntentos: 3            # intentos fallidos antes de detenerse y pedirte ayuda
    escalarEnIntento: 2       # desde qué intento usar el modelo más fuerte
    modeloEscalado:           # opcional
      provider: deepseek-official
      model: deepseek-v4-pro
    timeoutSegundos: 180      # límite por comando
    regresion: true           # verificar también los criterios de tareas anteriores
    pedirAprobacion: true
    verificarAlCerrar: true
```

Archivos en tu proyecto: `.entrega/` (contrato activo, criterios, historial y recibos). Te conviene versionarlos con Git.
