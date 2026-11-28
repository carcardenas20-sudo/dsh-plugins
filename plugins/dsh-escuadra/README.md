# dsh-escuadra

Varios agentes de DeepSeek escribiendo código **al mismo tiempo** en distintas partes del proyecto, sin pisarse. Ejemplo: uno hace la interfaz, otro la API, otro la base de datos, y al final otro las pruebas. Lo que solo tardaría una hora sale en una fracción.

## Cómo trabaja

1. **Reparte.** DeepSeek parte el encargo en tareas. Cada tarea tiene un rol, sus instrucciones, **los archivos que le pertenecen** y de qué otras depende. El plugin rechaza el reparto si dos tareas que corren a la vez comparten archivos, o si hay dependencias que no existen o que forman un círculo. Después ordena las tareas en oleadas.
2. **Cada agente en su propia copia del repo** (git worktree). Trabajan en paralelo, hasta 4 a la vez. `node_modules` y `.env` se enlazan solos para que puedan compilar y probar.
3. **Nadie se sale de su parte.** Lo que un agente cambie fuera de sus archivos se descarta. Si necesita algo de otra parte, por ejemplo una librería nueva, lo deja anotado como pendiente.
4. **Integra por oleadas.** Al terminar cada oleada se unen las ramas. Si hay conflicto, un agente integrador lo resuelve conservando lo de ambos lados. Las tareas que dependen de otras arrancan sobre lo ya integrado.
5. **Verifica y repara.** Cada tarea puede traer su comando de prueba y tiene un segundo intento si falla. Al final corre la verificación general, por ejemplo `npm test` o `mvn test`, con un intento de reparación.
6. **Revisión independiente.** Un agente que no escribió nada revisa todo contra el objetivo: que las piezas encajen, que no falte nada y que no haya huecos de seguridad.
7. **Aplica.** Si nadie tocó la rama mientras tanto, el resultado queda en tu rama actual con un commit por tarea. Si no, queda en la rama `escuadra/<fecha>/integracion`.

## Qué decirle

> Con la escuadra: agrega el módulo de pagos a Suzuka. Pantalla de pagos, API, tabla en la base de datos y pruebas.

DeepSeek lee el proyecto, te muestra el reparto en pocas líneas y lanza la escuadra. Al terminar te dice qué hizo cada agente, lo que quedó pendiente y el veredicto de la revisión.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `escuadra_repartir` | Valida y guarda el reparto (dueños de archivos, dependencias, oleadas). |
| `escuadra_ejecutar` | Lanza los agentes, integra, verifica, revisa y aplica. |
| `escuadra_limpiar` | Borra copias de trabajo y ramas `escuadra/*` viejas. |

Roles: `contratos` (tipos, interfaces, API y esquema que los demás usan), `interfaz`, `backend`, `datos`, `pruebas`, `documentacion`, `general`.

## Requisitos y límites

- El proyecto debe ser un **repositorio git con al menos un commit** y sin cambios sin guardar, porque los agentes parten del último commit.
- Usa los subagentes que ya trae Harness. Cada agente consume tokens como una conversación propia: 4 agentes cuestan más o menos lo que 4 conversaciones.
- Sirve para trabajos que se puedan partir. Para un cambio pequeño o de un solo archivo, DeepSeek no la usa.

## Configuración (opcional)

```yaml
- id: escuadra
  config:
    maxParalelo: 4          # agentes a la vez (Harness permite hasta 8)
    intentosVerificacion: 1 # segundo intento por tarea si su prueba falla
    reparaciones: 1         # intentos de arreglar la verificación general
    revisar: true           # revisión independiente al final
```

## Instalar

Harness → Plugins → Add plugin:
`https://raw.githubusercontent.com/carcardenas20-sudo/dsh-plugins/main/paquetes/dsh-escuadra-0.1.0.tgz`
