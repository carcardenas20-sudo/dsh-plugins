// dsh-prueba-entrega — "Prueba de entrega" para DeepSeek Harness.
//
// El agente no puede dar una tarea por terminada sin evidencia:
//   1. Antes de cambiar código, define criterios verificables y tú los apruebas.
//   2. Antes de cerrar su turno, el plugin ejecuta las verificaciones solo.
//   3. Si algo falla, obliga al agente a seguir trabajando (y puede escalar a
//      un modelo más fuerte). Si todo pasa, deja un recibo con la evidencia.
//   4. Los criterios aprobados quedan guardados como pruebas de regresión.
//
// Sin dependencias: usa solo servicios que dsh ya trae (tools, shell,
// workingDirectory, systemPrompt, approval).

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'

export const name = 'prueba-entrega'
export const inject = ['tools', 'workingDirectory', 'systemPrompt']

const DIR = '.entrega'
const SOURCE_KIND = 'prueba-entrega'
const DEFAULTS = {
  maxIntentos: 3,
  escalarEnIntento: 2,
  modeloEscalado: undefined, // { provider, model, reasoningEffort? }
  timeoutSegundos: 180,
  regresion: true,
  pedirAprobacion: true,
  verificarAlCerrar: true,
}

// Herramientas que pueden cambiar archivos: si alguna corre con un contrato
// activo, la próxima vez que el agente quiera cerrar se verifica de nuevo.
const MUTATING = /^(write|edit|apply_patch|bash|pwsh|powershell|shell|multi_edit|delete|move|create_file|notebook_edit)$|write|edit|patch/i

// ---------------------------------------------------------------- utilidades

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

/** Mensaje de contexto para el modelo, con la misma forma que crea dsh-llm. */
function notice(text, summary) {
  return deepFreeze(structuredClone({
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, form: 'notice', summary: summary.slice(0, 120) },
    id: randomUUID(),
  }))
}

const ahora = () => new Date().toISOString()
const tail = (text, max = 1500) => {
  const t = (text ?? '').trim()
  return t.length <= max ? t : '…' + t.slice(-max)
}
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tarea'

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return fallback }
}
async function writeJson(path, value) {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(tmp, path)
}

/** Ruta dentro del workspace, o error si intenta salir de él. */
function insideWorkspace(cwd, ruta) {
  const full = isAbsolute(ruta) ? resolve(ruta) : resolve(cwd, ruta)
  const rel = relative(cwd, full)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`la ruta "${ruta}" está fuera del proyecto`)
  return full
}

// ---------------------------------------------------------------- validación

function validarCriterios(lista) {
  if (!Array.isArray(lista) || lista.length === 0) throw new Error('debes enviar al menos un criterio')
  if (lista.length > 20) throw new Error('máximo 20 criterios por tarea; agrupa los parecidos')
  return lista.map((c, i) => {
    const id = `c${i + 1}`
    if (typeof c?.descripcion !== 'string' || !c.descripcion.trim()) throw new Error(`${id}: falta "descripcion"`)
    const v = c.verificacion ?? {}
    if (v.tipo === 'comando') {
      if (typeof v.comando !== 'string' || !v.comando.trim()) throw new Error(`${id}: el tipo comando necesita "comando"`)
    } else if (v.tipo === 'archivo') {
      if (typeof v.ruta !== 'string' || !v.ruta.trim()) throw new Error(`${id}: el tipo archivo necesita "ruta"`)
    } else {
      throw new Error(`${id}: verificacion.tipo debe ser "comando" o "archivo"`)
    }
    const verificacion = { tipo: v.tipo }
    for (const k of ['comando', 'ruta', 'contiene', 'espera_texto']) if (typeof v[k] === 'string' && v[k] !== '') verificacion[k] = v[k]
    if (Number.isFinite(v.timeout_segundos) && v.timeout_segundos > 0) verificacion.timeout_segundos = Math.min(v.timeout_segundos, 1800)
    return { id, descripcion: c.descripcion.trim(), verificacion }
  })
}

const describirVerificacion = (v) =>
  v.tipo === 'comando'
    ? `ejecutar \`${v.comando}\`${v.espera_texto ? ` y que la salida contenga "${v.espera_texto}"` : ' y que termine sin error'}`
    : `que exista \`${v.ruta}\`${v.contiene ? ` y contenga "${v.contiene}"` : ''}`

// ---------------------------------------------------------------- plugin

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const states = new WeakMap() // agent -> estado en memoria

  function stateOf(agent) {
    let s = states.get(agent)
    if (!s) {
      s = { cwd: undefined, loaded: false, contrato: undefined, dirty: false, intentos: 0, modeloOriginal: undefined, avisado: false }
      states.set(agent, s)
    }
    return s
  }

  async function cwdOf(agent, signal) {
    const s = stateOf(agent)
    if (!s.cwd) s.cwd = await ctx.workingDirectory.ensure(agent, signal)
    return s.cwd
  }

  async function load(agent, signal) {
    const s = stateOf(agent)
    if (!s.loaded) {
      const cwd = await cwdOf(agent, signal)
      const guardado = await readJson(join(cwd, DIR, 'contrato-activo.json'), undefined)
      if (guardado && guardado.estado === 'activo') s.contrato = guardado
      s.loaded = true
    }
    return s
  }

  async function saveActive(agent, signal) {
    const s = stateOf(agent)
    const cwd = await cwdOf(agent, signal)
    await mkdir(join(cwd, DIR), { recursive: true })
    await writeJson(join(cwd, DIR, 'contrato-activo.json'), s.contrato ?? { estado: 'ninguno' })
  }

  // ------------------------------------------------ ejecutar verificaciones

  async function runShell(agent, command, cwd, timeoutMs, signal) {
    const shell = ctx.get('shell')
    if (!shell) return { ok: false, evidencia: 'No hay terminal disponible en este perfil de dsh.' }
    const policy = shell.sandboxMode === undefined ? undefined
      : ctx.get('sandboxPolicy')?.resolve({ session: agent.session })
    const spec = shell.resolve({
      command, workdir: cwd, timeoutMs, signal,
      ...(policy !== undefined ? { sandboxPolicy: policy } : {}),
    })
    const r = await (await shell.execute(spec)).result()
    const salida = [r.stdout?.text, r.stderr?.text].filter(Boolean).join('\n')
    return { exitCode: r.exitCode, timedOut: r.timedOut, aborted: r.aborted, salida }
  }

  async function verificarUno(agent, criterio, cwd, signal) {
    const v = criterio.verificacion
    const inicio = Date.now()
    try {
      if (v.tipo === 'archivo') {
        const full = insideWorkspace(cwd, v.ruta)
        let contenido
        try { contenido = await readFile(full, 'utf8') } catch { return { ok: false, evidencia: `No existe ${v.ruta}` } }
        if (v.contiene && !contenido.includes(v.contiene)) return { ok: false, evidencia: `${v.ruta} existe pero no contiene "${v.contiene}"` }
        return { ok: true, evidencia: `${v.ruta} existe${v.contiene ? ` y contiene "${v.contiene}"` : ''} (${contenido.length} caracteres)` }
      }
      const timeoutMs = (v.timeout_segundos ?? config.timeoutSegundos) * 1000
      const r = await runShell(agent, v.comando, cwd, timeoutMs, signal)
      if (r.ok === false) return r
      if (r.aborted) return { ok: false, evidencia: 'Cancelado.' }
      if (r.timedOut) return { ok: false, evidencia: `Superó el tiempo límite de ${timeoutMs / 1000}s.\n${tail(r.salida, 800)}` }
      const textoOk = !v.espera_texto || r.salida.includes(v.espera_texto)
      const ok = r.exitCode === 0 && textoOk
      const motivo = r.exitCode !== 0 ? `Terminó con código ${r.exitCode}.` : textoOk ? 'Terminó sin error.' : `La salida no contiene "${v.espera_texto}".`
      return { ok, evidencia: `${motivo} (${((Date.now() - inicio) / 1000).toFixed(1)}s)\n${tail(r.salida)}` }
    } catch (e) {
      return { ok: false, evidencia: `Error al verificar: ${e?.message ?? e}` }
    }
  }

  /** Corre el contrato activo + las regresiones guardadas y escribe el recibo. */
  async function verificarTodo(agent, signal, origen) {
    const s = await load(agent, signal)
    const cwd = await cwdOf(agent, signal)
    const c = s.contrato
    const lista = c ? c.criterios.map((k) => ({ ...k, grupo: 'tarea' })) : []
    if (config.regresion) {
      const lib = await readJson(join(cwd, DIR, 'criterios.json'), [])
      const propios = new Set(lista.map((k) => `${c?.id}-${k.id}`))
      for (const k of lib) if (!propios.has(k.id)) lista.push({ ...k, grupo: 'regresión' })
    }
    if (lista.length === 0) return undefined

    const resultados = []
    for (const k of lista) {
      if (signal?.aborted) break
      resultados.push({ ...k, ...(await verificarUno(agent, k, cwd, signal)) })
    }
    const fallos = resultados.filter((r) => !r.ok)
    const recibo = await escribirRecibo(cwd, c, resultados, origen, s.intentos)
    if (c) {
      c.ultimaVerificacion = { fecha: ahora(), verde: fallos.length === 0, fallos: fallos.map((f) => f.id), recibo }
    }
    s.dirty = false
    return { resultados, fallos, recibo }
  }

  async function escribirRecibo(cwd, c, resultados, origen, intentos) {
    await mkdir(join(cwd, DIR, 'recibos'), { recursive: true })
    const fecha = ahora()
    const verde = resultados.every((r) => r.ok)
    const archivo = `${fecha.slice(0, 23).replace(/[:T.]/g, '-')}-${slug(c?.tarea ?? 'regresion')}-${verde ? 'ok' : 'falla'}.md`
    const lineas = [
      `# Recibo de entrega: ${c?.tarea ?? 'verificación de regresión'}`,
      '',
      `- **Resultado:** ${verde ? '✅ TODO PASA' : `❌ ${resultados.filter((r) => !r.ok).length} de ${resultados.length} fallan`}`,
      `- **Fecha:** ${fecha}`,
      `- **Verificado por:** ${origen === 'auto' ? 'el plugin, automáticamente al cerrar el turno' : 'llamada del agente a entrega_verificar'}`,
      ...(c ? [`- **Criterios aprobados por el usuario:** ${c.aprobado === true ? 'sí' : c.aprobado === false ? 'no (sin confirmación)' : 'no se pidió'}`] : []),
      ...(intentos ? [`- **Intentos fallidos previos:** ${intentos}`] : []),
      '',
      '| | Criterio | Grupo | Verificación |',
      '| --- | --- | --- | --- |',
      ...resultados.map((r) => `| ${r.ok ? '✅' : '❌'} | ${r.descripcion.replace(/\|/g, '\\|')} | ${r.grupo} | ${describirVerificacion(r.verificacion).replace(/\|/g, '\\|')} |`),
      '',
      '## Evidencia',
      '',
      ...resultados.flatMap((r) => [`### ${r.ok ? '✅' : '❌'} ${r.descripcion}`, '', '```', r.evidencia, '```', '']),
    ]
    await writeFile(join(cwd, DIR, 'recibos', archivo), lineas.join('\n'), 'utf8')
    return `${DIR}/recibos/${archivo}`
  }

  const resumen = (v) => v.resultados.map((r) => `${r.ok ? '✅' : '❌'} [${r.grupo}] ${r.descripcion}${r.ok ? '' : `\n   ${tail(r.evidencia, 600).replace(/\n/g, '\n   ')}`}`).join('\n')

  async function cerrarContrato(agent, signal, estado) {
    const s = stateOf(agent)
    if (s.contrato) {
      s.contrato.estado = estado
      s.contrato.cerrado = ahora()
      const cwd = await cwdOf(agent, signal)
      const hist = await readJson(join(cwd, DIR, 'historial.json'), [])
      hist.push(s.contrato)
      await writeJson(join(cwd, DIR, 'historial.json'), hist.slice(-200))
    }
    s.contrato = undefined
    s.intentos = 0
    s.dirty = false
    await saveActive(agent, signal)
    restaurarModelo(agent)
  }

  function escalarModelo(agent) {
    const s = stateOf(agent)
    const m = config.modeloEscalado
    if (!m?.provider || !m?.model || s.modeloOriginal !== undefined) return false
    try {
      s.modeloOriginal = agent.model.current() ?? null
      agent.model.select({ provider: m.provider, model: m.model, ...(m.reasoningEffort ? { reasoningEffort: m.reasoningEffort } : {}) })
      return true
    } catch (e) {
      ctx.logger?.warn?.(`prueba-entrega: no pude escalar el modelo: ${e?.message ?? e}`)
      s.modeloOriginal = undefined
      return false
    }
  }

  function restaurarModelo(agent) {
    const s = stateOf(agent)
    if (s.modeloOriginal === undefined) return
    try { if (s.modeloOriginal) agent.model.select(s.modeloOriginal) } catch { /* sesión cerrada */ }
    s.modeloOriginal = undefined
  }

  // ------------------------------------------------ herramientas del modelo

  const text = { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] }
  const verificacionSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      tipo: { type: 'string', enum: ['comando', 'archivo'], description: 'comando: ejecuta un comando de terminal en la raíz del proyecto. archivo: revisa que un archivo exista y opcionalmente contenga un texto.' },
      comando: { type: 'string', description: 'Comando a ejecutar (tests, build, curl a un endpoint, script). Pasa si termina con código 0.' },
      espera_texto: { type: 'string', description: 'Opcional: texto que debe aparecer en la salida del comando.' },
      ruta: { type: 'string', description: 'Ruta relativa al proyecto, para tipo archivo.' },
      contiene: { type: 'string', description: 'Opcional: texto que el archivo debe contener.' },
      timeout_segundos: { type: 'number', description: 'Opcional: límite de tiempo para este comando.' },
    },
    required: ['tipo'],
  }

  ctx.tools.register({
    name: 'entrega_definir',
    description:
      'Define el contrato de entrega de la tarea actual ANTES de cambiar código: criterios de aceptación en lenguaje claro, cada uno con una verificación objetiva ' +
      '(un comando como los tests del proyecto, o un archivo que debe existir). El usuario los aprueba. Mientras el contrato esté activo, no podrás cerrar el turno hasta que todos pasen. ' +
      'Prefiere verificaciones reales del proyecto (npm test, pytest, build, un script de prueba que escribas) sobre comprobaciones triviales.',
    parameters: {
      type: 'object',
      properties: {
        tarea: { type: 'string', description: 'Qué pidió el usuario, en una frase.' },
        criterios: {
          type: 'array',
          description: 'De 1 a 20 criterios verificables.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              descripcion: { type: 'string', description: 'El criterio en lenguaje de negocio, entendible por alguien que no programa.' },
              verificacion: verificacionSchema,
            },
            required: ['descripcion', 'verificacion'],
          },
        },
        guardar_como_regresion: { type: 'boolean', description: 'Si los criterios se guardan para verificarlos en tareas futuras. Por defecto true.' },
      },
      required: ['tarea', 'criterios'],
    },
    output: text,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('entrega_definir necesita una sesión de agente')
      const s = await load(exec.agent, exec.signal)
      const criterios = validarCriterios(args.criterios)
      const tarea = String(args.tarea ?? '').trim() || 'Tarea sin nombre'
      const lectura = criterios.map((k) => `${k.id}. ${k.descripcion}\n    → ${describirVerificacion(k.verificacion)}`).join('\n')

      let aprobado
      const approval = ctx.get('approval')
      if (config.pedirAprobacion && approval) {
        const outcome = await approval.request({
          agent: exec.agent,
          toolName: 'entrega_definir',
          callId: exec.callId,
          reason: `Criterios para dar por terminada "${tarea}":\n${lectura}`,
          signal: exec.signal,
        })
        if (outcome === 'rejected') {
          return `El usuario RECHAZÓ estos criterios. No empieces a programar: pregúntale qué quiere cambiar y vuelve a llamar entrega_definir.\n\n${lectura}`
        }
        if (outcome === 'cancelled') return 'La aprobación se canceló. No se guardó ningún contrato.'
        aprobado = outcome === 'allowed-once' ? true : false // 'unavailable' => sin confirmar
      }

      const previo = s.contrato
      s.contrato = {
        id: `${new Date().toISOString().slice(0, 10)}-${slug(tarea)}-${randomUUID().slice(0, 4)}`,
        tarea, criterios, aprobado, estado: 'activo', creado: ahora(),
        regresion: args.guardar_como_regresion !== false,
      }
      s.intentos = 0
      s.dirty = true
      s.avisado = false
      await saveActive(exec.agent, exec.signal)
      return [
        `Contrato activo: "${tarea}"${aprobado === true ? ' (aprobado por el usuario)' : aprobado === false ? ' (sin confirmación del usuario: no hay quien apruebe en esta interfaz)' : ''}.`,
        previo ? `Reemplazó el contrato anterior "${previo.tarea}".` : '',
        lectura,
        '',
        'Ahora haz el trabajo. Cuando creas que terminaste, llama entrega_verificar. Si intentas cerrar sin que todo pase, el plugin verificará y te devolverá los fallos.',
      ].filter(Boolean).join('\n')
    },
  })

  ctx.tools.register({
    name: 'entrega_verificar',
    description:
      'Ejecuta todas las verificaciones del contrato activo y las regresiones guardadas, escribe un recibo con la evidencia en .entrega/recibos/ y te dice qué falla. ' +
      'Si todo pasa, el contrato se cierra y sus criterios quedan como regresión. Llámala cuando creas que terminaste.',
    parameters: { type: 'object', properties: {} },
    output: text,
    async execute(_args, exec) {
      if (!exec.agent) throw new Error('entrega_verificar necesita una sesión de agente')
      const s = await load(exec.agent, exec.signal)
      const tarea = s.contrato?.tarea
      const v = await verificarTodo(exec.agent, exec.signal, 'agente')
      if (!v) return 'No hay contrato activo ni criterios guardados. Usa entrega_definir antes de cambiar código.'
      if (v.fallos.length === 0) {
        if (s.contrato) {
          await guardarRegresion(exec.agent, exec.signal)
          await cerrarContrato(exec.agent, exec.signal, 'cumplido')
        }
        return `✅ Todo pasa (${v.resultados.length} verificaciones). Recibo: ${v.recibo}\n${resumen(v)}\n\n${tarea ? `Contrato "${tarea}" cerrado. ` : ''}Resume al usuario qué quedó verificado y dónde está el recibo.`
      }
      if (s.contrato) await saveActive(exec.agent, exec.signal)
      return `❌ Fallan ${v.fallos.length} de ${v.resultados.length}. Recibo: ${v.recibo}\n${resumen(v)}\n\nCorrige lo que falla y vuelve a verificar. No cambies un criterio para que pase: si un criterio está mal planteado, explícaselo al usuario.`
    },
  })

  ctx.tools.register({
    name: 'entrega_estado',
    description: 'Muestra el contrato de entrega activo, su último resultado y cuántas regresiones hay guardadas.',
    parameters: { type: 'object', properties: {} },
    output: text,
    async execute(_args, exec) {
      if (!exec.agent) throw new Error('entrega_estado necesita una sesión de agente')
      const s = await load(exec.agent, exec.signal)
      const cwd = await cwdOf(exec.agent, exec.signal)
      const lib = await readJson(join(cwd, DIR, 'criterios.json'), [])
      if (!s.contrato) return `Sin contrato activo. Regresiones guardadas: ${lib.length}.`
      const c = s.contrato
      const u = c.ultimaVerificacion
      return [
        `Contrato activo: "${c.tarea}" (${c.criterios.length} criterios, creado ${c.creado})`,
        ...c.criterios.map((k) => `${u ? (u.fallos.includes(k.id) ? '❌' : '✅') : '•'} ${k.id}. ${k.descripcion}`),
        u ? `Última verificación: ${u.verde ? 'verde' : 'roja'} (${u.fecha}), recibo ${u.recibo}` : 'Aún sin verificar.',
        `Cambios desde la última verificación: ${s.dirty ? 'sí' : 'no'}. Intentos fallidos: ${s.intentos}. Regresiones guardadas: ${lib.length}.`,
      ].join('\n')
    },
  })

  async function guardarRegresion(agent, signal) {
    const s = stateOf(agent)
    const c = s.contrato
    if (!c || !c.regresion || !config.regresion) return
    const cwd = await cwdOf(agent, signal)
    const path = join(cwd, DIR, 'criterios.json')
    const lib = await readJson(path, [])
    const ids = new Set(lib.map((k) => k.id))
    for (const k of c.criterios) {
      const id = `${c.id}-${k.id}`
      if (!ids.has(id)) lib.push({ id, tarea: c.tarea, descripcion: k.descripcion, verificacion: k.verificacion, creado: ahora() })
    }
    await writeJson(path, lib)
  }

  // ------------------------------------------------ instrucciones al modelo

  ctx.systemPrompt.section({
    name: 'prueba-entrega',
    order: 2450,
    interpolate: false,
    text: [
      '## Prueba de entrega',
      'This workspace uses evidence-based delivery. For any task that changes code or files (not for questions or pure reading):',
      '1. Before editing, call `entrega_definir` with acceptance criteria written in plain language the user understands, each with an objective check (prefer the project\'s real tests/build, or write a small test script first). Keep criteria few and meaningful. Write criteria in the user\'s language.',
      '2. Do the work.',
      '3. Call `entrega_verificar`. Never tell the user the task is done unless it returned ✅. If something fails, fix the code, not the criterion.',
      'If you try to end your turn with an active contract that has unverified changes, the harness runs the checks itself and sends you the failures.',
    ].join('\n'),
  })

  // ------------------------------------------------ cambios de archivos

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    try {
      if (exec.agent && !exec.name.startsWith('entrega_') && MUTATING.test(exec.name)) {
        const s = stateOf(exec.agent)
        if (s.contrato) s.dirty = true
        else if (!s.loaded) s.dirtyAntesDeCargar = true
      }
    } catch { /* nunca romper el pipeline */ }
    return downstream
  })

  // El usuario volvió a escribir: nuevos intentos, sin bloqueo.
  ctx.on('agent/pre-step', ({ agent, messages }, next) => {
    if (messages.some((m) => m.source?.kind === 'user')) {
      const s = states.get(agent)
      if (s) { s.intentos = 0; s.avisado = false; if (s.contrato?.estado === 'bloqueado') s.contrato.estado = 'activo' }
    }
    return next()
  })

  // ------------------------------------------------ el candado al cerrar

  ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    if (!config.verificarAlCerrar) return
    let s
    try { s = await load(agent, signal) } catch { return }
    if (s.dirtyAntesDeCargar) { s.dirty = true; s.dirtyAntesDeCargar = false }
    const c = s.contrato
    if (!c || c.estado !== 'activo') return
    if (!s.dirty && c.ultimaVerificacion?.verde !== false) return
    if (!s.dirty && s.avisado) return

    let v
    try { v = await verificarTodo(agent, signal, 'auto') } catch (e) {
      ctx.logger?.warn?.(`prueba-entrega: falló la verificación automática: ${e?.message ?? e}`)
      return
    }
    if (!v || signal?.aborted) return

    if (v.fallos.length === 0) {
      await guardarRegresion(agent, signal)
      await cerrarContrato(agent, signal, 'cumplido')
      agent.steer(notice(
        `[Prueba de entrega] El plugin verificó automáticamente: ✅ todo pasa (${v.resultados.length} verificaciones). Recibo: ${v.recibo}\n${resumen(v)}\nResume al usuario en dos líneas qué quedó verificado y dónde está el recibo. No hagas más cambios.`,
        `Entrega verificada: ${v.resultados.length} ✅`,
      ))
      return
    }

    s.intentos += 1
    if (s.intentos > config.maxIntentos) {
      c.estado = 'bloqueado'
      await saveActive(agent, signal)
      restaurarModelo(agent)
      if (!s.avisado) {
        s.avisado = true
        agent.steer(notice(
          `[Prueba de entrega] Después de ${config.maxIntentos} intentos siguen fallando ${v.fallos.length} criterios. Recibo: ${v.recibo}\n${resumen(v)}\nNO digas que la tarea está terminada. Explícale al usuario, en lenguaje simple, qué falla y qué necesitas de él para seguir. No hagas más cambios en este turno.`,
          `Entrega bloqueada: ${v.fallos.length} ❌`,
        ))
      }
      return
    }

    await saveActive(agent, signal)
    const escalo = s.intentos >= config.escalarEnIntento && escalarModelo(agent)
    agent.steer(notice(
      `[Prueba de entrega] Intentaste cerrar, pero la verificación automática falló (intento ${s.intentos} de ${config.maxIntentos}). Recibo: ${v.recibo}\n${resumen(v)}\n` +
      (escalo ? `Se cambió a un modelo más fuerte (${config.modeloEscalado.model}) para resolverlo.\n` : '') +
      'Corrige el código para que pase. No modifiques ni relajes los criterios. Cuando termines, llama entrega_verificar.',
      `Entrega: ${v.fallos.length} ❌ (intento ${s.intentos})`,
    ))
  })

  // ------------------------------------------------ candado sobre las metas de dsh

  ctx.tools.guard((exec) => {
    if (exec.name !== 'update_goal' || exec.arguments?.action !== 'complete' || !exec.agent) return undefined
    const c = states.get(exec.agent)?.contrato
    if (!c || c.estado === 'cumplido') return undefined
    return `Prueba de entrega: hay un contrato activo ("${c.tarea}") sin verificar en verde. Llama entrega_verificar y corrige lo que falle antes de marcar la meta como completa.`
  })
}

// Exportado solo para pruebas.
export const _internals = { validarCriterios, describirVerificacion, insideWorkspace, notice, MUTATING }
