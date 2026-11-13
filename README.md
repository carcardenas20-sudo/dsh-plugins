# Plugins para DeepSeek Harness

Diez plugins para [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), sin dependencias y probados en dsh 0.2.2.

| Plugin | Para qué |
| --- | --- |
| [dsh-prueba-entrega](plugins/dsh-prueba-entrega) | El agente no puede decir "listo" sin evidencia: criterios aprobados por ti, verificación obligatoria antes de cerrar, recibo y regresiones. |
| [dsh-enrutador](plugins/dsh-enrutador) | Flash por defecto, V4 Pro solo cuando hace falta, con topes de gasto por tarea y por día. |
| [dsh-traductor-cambios](plugins/dsh-traductor-cambios) | Cada cambio de código explicado para quien no programa, con riesgo 🟢🟡🔴 que el agente no puede bajar. |
| [dsh-ojos](plugins/dsh-ojos) | Deja usar imágenes con V4 Pro: Flash las mira y le pasa a Pro una descripción detallada. |
| [dsh-rea](plugins/dsh-rea) | Ingeniería inversa con REA usando 3 herramientas en vez de 229 (ahorra ~70.000 tokens por llamada). |
| [dsh-planos](plugins/dsh-planos) | Planos visuales (flujos, mapa de la plataforma, arquitectura, base de datos) que se abren en el panel de dsh. |
| [dsh-memoria](plugins/dsh-memoria) | Memoria de proyecto: bitácora de cada turno, memoria viva en AGENTS.md que se carga en cada conversación, herramientas para buscar y anotar, e importar conversaciones anteriores. |
| [dsh-artefactos](plugins/dsh-artefactos) | Páginas interactivas (formularios, tablas, calculadoras, tableros, gráficos) que guardan lo que ingresas en el proyecto para que el agente lo lea. |
| [dsh-segunda-opinion](plugins/dsh-segunda-opinion) | Otro modelo (V4-Pro) revisa los cambios antes de entregar y obliga a corregir errores reales. |
| [dsh-confeccion-xt](plugins/dsh-confeccion-xt) | Costos de prenda, precios de venta y rentabilidad de lotes para confección. |

Los tres primeros funcionan juntos: si la Prueba de entrega falla, el Enrutador sube al modelo fuerte, y el Traductor deja el cambio explicado al final.

## Instalar

Perfil web (PowerShell, macOS o Linux):

```
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-prueba-entrega"
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-enrutador"
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-traductor-cambios"
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-ojos"
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-rea"
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-planos"
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-memoria"
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-artefactos"
dsh plugin --profile web add "github:carcardenas20-sudo/dsh-plugins#path:plugins/dsh-segunda-opinion"
```

Harness Desktop: desde Settings → Plugins con el mismo enlace, o pídele al agente que los instale con el administrador de plugins.

Quitar: `dsh plugin --profile web remove dsh-prueba-entrega` (igual para los demás).

## Desarrollo

```
npm test        # pruebas de comportamiento
npm run pack    # genera los .tgz en dist/
```

Licencia MIT.
