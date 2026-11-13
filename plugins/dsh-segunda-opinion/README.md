# dsh-segunda-opinion

Un segundo cerebro revisa el trabajo del agente **antes** de que te lo entregue.

## Cómo funciona

1. Antes de que el agente modifique un archivo, el plugin guarda cómo estaba.
2. Cuando el agente intenta terminar, arma el "antes y después" de todo lo que cambió y se lo da a **otro modelo (DeepSeek-V4-Pro)** junto con lo que tú pediste.
3. Ese revisor busca problemas **reales**:
   - errores de lógica y cálculos mal hechos;
   - casos que no se contemplan (vacíos, ceros, negativos, nulos, fechas);
   - cosas que el cambio rompe en otra parte;
   - que no cumpla lo que pediste, o lo cumpla a medias;
   - seguridad (datos sin validar, inyección SQL, claves expuestas).

   No opina de estilo ni de gustos.
4. Si encuentra problemas importantes, el agente **tiene que corregirlos** antes de entregarte, o explicarte en una línea por qué el revisor se equivoca. Después vuelve a pasar por revisión, con un máximo de 2 rondas por pedido.
5. Si todo está bien, pasa en silencio.

No revisa cambios muy pequeños (menos de 4 líneas) ni documentos (.md, .txt), para no gastar en lo trivial. Si el revisor falla o tarda, no bloquea nada.

También puedes pedirlo a mano: *"dame una segunda opinión de lo que cambió"* o *"revisa la seguridad de los cambios"*. La herramienta `segunda_opinion` revisa lo de este pedido o, si no hay, los cambios sin confirmar de git.

## Costo

Cada revisión es una llamada a V4-Pro con el pedido y los cambios. Solo ocurre cuando el agente cambió código de verdad. Si quieres que sea más barato, usa Flash como revisor (atrapa menos, pero ayuda).

## Instalar

En Harness: Plugins → Add plugin →
```
github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-segunda-opinion
```

Se lleva bien con **dsh-prueba-entrega**: la segunda opinión atrapa errores de razonamiento y la prueba de entrega exige que las pruebas pasen.

## Configuración (opcional)

| Clave | Por defecto | Qué hace |
| --- | --- | --- |
| `revisor.model` | `deepseek-v4-pro` | Modelo revisor (`deepseek-flash` = más barato). |
| `rondas` | `2` | Máximo de veces que devuelve el trabajo en un pedido. |
| `minLineas` | `4` | No revisar cambios más pequeños. |
| `gravedadMinima` | `media` | `alta` = solo devuelve por problemas graves. |
| `revisarDocs` | `false` | Revisar también documentos .md/.txt. |

Probado en dsh 0.2.2: el agente escribió una función que dividía por cero, el revisor lo detectó, el agente lo corrigió solo y la segunda revisión aprobó.
