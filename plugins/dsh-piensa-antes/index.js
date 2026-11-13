// dsh-piensa-antes — en tareas grandes, el agente planea antes de programar.
//
// 1. Cuando el pedido del usuario es grande (crear un módulo, integrar algo, refactorizar,
//    tocar la base de datos, varios archivos…), el plugin NO deja editar archivos hasta que
//    el agente escriba un plan con plan_crear: objetivo, pasos con archivos, riesgos,
//    alternativas y cómo lo va a probar. Leer y explorar sí puede, para planear bien.
// 2. Un arquitecto revisor (V4-Pro) lee el plan y señala huecos: riesgos que no vio,
//    archivos que faltan, un orden mejor o una salida más simple. El agente ajusta y arranca.
// 3. Opcional: esperar tu visto bueno antes de tocar código.
// Las tareas pequeñas pasan sin plan. Si dices "sin plan" o "rápido", también.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const name = 'piensa-antes'
export const inject = ['tools', 'llm', 'workingDirectory', 'systemPrompt']

const DEFAULTS = {
  revisor: { model: 'deepseek-v4-pro' }, // provider: el del agente
  revisarPlan: true,
  esperarAprobacion: false, // true = mostrarte el plan y esperar tu "dale" antes de editar
  carpeta: '.dsh-planes',
  timeoutSegundos: 150,
  minCaracteres: 450, // pedidos así de largos se tratan como grandes
}

const MUTA = /^(write|edit|multi_?edit|apply_?patch|create|str_replace|notebook_edit|patch|delete|move|rename)/i

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const GRANDE = [
  /\b(implementa|implementar|desarrolla|desarrollar|construye|construir|programa(r)?)\b/,
  /\b(crea|crear|haz|hacer|arma|armar|agrega|agregar|anade|anadir)\b.{0,40}\b(modulo|sistema|api|servicio|plataforma|aplicacion|app|funcionalidad|feature|backend|frontend|panel|dashboard|tablero|crud|endpoint|integracion|flujo|pasarela|autenticacion|login|registro de usuarios|roles|permisos|reportes?)\b/,
  /\b(refactoriza|refactorizar|refactor|reestructura|reestructurar|rediseña|redisena|redisenar|migra|migrar|migracion|moderniza)\b/,
  /\b(integra|integrar|conecta|conectar)\b.{0,40}\b(api|pasarela|pagos|base de datos|servicio|whatsapp|supabase|stripe|wompi|webhook)/,
  /\b(arquitectura|esquema de (la )?base de datos|modelo de datos|tablas nuevas|multi[- ]?tenant|microservicio)/,
  /\b(todo el proyecto|varios archivos|toda la app|toda la aplicacion|de cero|desde cero)\b/,
]
const PEQUENO = /\b(sin plan|rapido|rapidito|solo (cambia|arregla|corrige)|typo|tilde|ortografia|renombra (la|el) variable|cambia el color|cambia el texto)\b/

/** ¿El pedido merece un plan antes de programar? */
export function esGrande(texto, minCaracteres = DEFAULTS.minCaracteres) {
  const t = norm(texto)
  if (!t.trim()) return false
  if (PEQUENO.test(t)) return false
  if (/\b(con plan|planea|planifica|haz un plan)\b/.test(t)) return true
  if (t.length >= minCaracteres) return true
  return GRANDE.some((r) => r.test(t))
}

export const INSTRUCCION_REVISOR = [
  'Eres un arquitecto de software senior. Otro agente va a implementar el pedido del usuario siguiendo este plan. Revisa el PLAN (todavía no hay código).',
  'Señala SOLO lo que haría fallar o empeorar el resultado:',
  '- Pasos que faltan o están en mal orden (por ejemplo, migrar la base de datos antes de usar las columnas nuevas).',
  '- Archivos o partes del sistema afectados que el plan no menciona.',
  '- Riesgos no contemplados: datos existentes, compatibilidad, seguridad, errores de red, concurrencia, casos borde.',
  '- Si hay una forma claramente más simple o segura de lograr lo mismo.',
  '- Si el plan no cumple lo que pidió el usuario.',
  '- Si la forma de probar no demostraría que funciona.',
  'Sé breve y concreto: máximo 8 puntos, cada uno con qué ajustar. Si el plan está bien, dilo en una línea. No reescribas el plan completo. Escribe en español.',
].join('\n')

const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'plan'
const hoy = () => { const d = new Date(); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}` }

export function planMarkdown(p, pedido) {
  const L = [`# Plan: ${p.objetivo}`, '', `**Pedido:** ${String(pedido).slice(0, 1500)}`, '']
  if (p.contexto) L.push('## Lo que encontré', p.contexto, '')
  L.push('## Pasos')
  p.pasos.forEach((x, i) => L.push(`${i + 1}. ${x.paso}${x.archivos?.length ? ` — \`${x.archivos.join('`, `')}\`` : ''}`))
  L.push('', '## Riesgos', ...(p.riesgos ?? []).map((r) => `- ${r}`))
  if (p.alternativas?.length) L.push('', '## Alternativas consideradas', ...p.alternativas.map((a) => `- ${a}`))
  L.push('', '## Cómo se va a probar', ...(p.pruebas ?? []).map((r) => `- ${r}`))
  return L.join('\n')
}

export function apply(ctx, rawConfig) {
  const cfg = { ...DEFAULTS, ...(rawConfig ?? {}), revisor: { ...DEFAULTS.revisor, ...(rawConfig?.revisor ?? {}) } }
  const estados = new WeakMap() // agent -> { pedido, grande, plan, esperando, revisiones }

  ctx.systemPrompt.section({
    name: 'piensa-antes',
    order: 2440,
    interpolate: false,
    text: [
      '## Piensa antes',
      'For large tasks (new modules or features, integrations, refactors, database or architecture changes, several files), plan before editing:',
      '1. First explore and read the relevant code (no edits).',
      '2. Call `plan_crear` with the goal, ordered steps with the files each one touches, risks, alternatives you considered and how you will test it. Write it in the user\'s language.',
      '3. Read the architect\'s feedback in the result; if it found real gaps, call `plan_crear` again with the improved plan.',
      '4. Implement following the plan. If you must change course, update it with `plan_crear`.',
      'Editing tools are blocked for large tasks until a plan exists. Small tasks don\'t need a plan.',
    ].join('\n'),
  })

  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      if (decision?.kind === 'enter' && payload.agent) {
        const delUsuario = (decision.messages ?? []).filter((m) => m?.source?.kind === 'user')
        if (delUsuario.length) {
          const texto = delUsuario.map((m) => (m.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n')).join('\n')
          const previo = estados.get(payload.agent)
          if (previo?.esperando && previo.plan) {
            // El usuario respondió al plan: si no lo frena, se considera aprobado.
            const t = norm(texto)
            previo.esperando = /\b(no|espera|cambia|ajusta|mejor|todavia no|aun no)\b/.test(t) && !/\b(dale|si|listo|ok|aprobado|adelante|hagale|de una)\b/.test(t)
            previo.pedido += `\n\n${texto}`
            if (!previo.esperando) return decision
          }
          if (previo?.esperando) { estados.set(payload.agent, { ...previo, revisiones: 0 }); return decision } // sigue esperando: el agente ajusta el plan
          estados.set(payload.agent, { pedido: texto, grande: esGrande(texto, cfg.minCaracteres), plan: null, esperando: false, revisiones: 0 })
        }
      }
    } catch {}
    return decision
  })

  ctx.tools.guard((exec) => {
    if (!exec?.agent || !MUTA.test(exec.name ?? '')) return undefined
    const s = estados.get(exec.agent)
    if (!s?.grande) return undefined
    if (!s.plan) return 'Piensa antes: esta es una tarea grande. Antes de editar archivos, explora el código y llama plan_crear con el objetivo, los pasos (con archivos), los riesgos, alternativas y cómo lo vas a probar.'
    if (s.esperando) return 'Piensa antes: el plan está esperando el visto bueno del usuario. Muéstraselo y espera su respuesta antes de editar.'
    return undefined
  })

  async function revisarPlan(agent, signal, plan, pedido) {
    const sel = agent.model?.current?.()
    const provider = cfg.revisor.provider ?? sel?.provider
    if (!provider) return null
    const timeout = AbortSignal.timeout(cfg.timeoutSegundos * 1000)
    const stream = ctx.llm.stream({
      provider, model: cfg.revisor.model, system: INSTRUCCION_REVISOR,
      ...(agent.session?.id ? { sessionId: agent.session.id } : {}),
      messages: [Object.freeze({ role: 'user', id: globalThis.crypto.randomUUID(), source: Object.freeze({ kind: 'user' }), content: Object.freeze([Object.freeze({ type: 'text', text: `PEDIDO DEL USUARIO:\n"""${String(pedido).slice(0, 6000)}"""\n\nPLAN:\n${planMarkdown(plan, '').replace(/^\*\*Pedido:\*\*.*$/m, '')}` })]) })],
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    let out = ''
    let fin
    for await (const c of stream) { if (c.type === 'text-delta') out += c.text; else if (c.type === 'finish') fin = c.reason }
    if (fin?.kind && fin.kind !== 'stop') throw new Error(fin.failure?.message ?? fin.kind)
    return out.trim()
  }

  ctx.tools.register({
    name: 'plan_crear',
    description: 'Registra el plan de una tarea grande ANTES de editar archivos (requisito para tareas grandes). Un arquitecto revisor (V4-Pro) lo revisa y te devuelve observaciones; si señala huecos reales, vuelve a llamarla con el plan mejorado. Llámala también si cambias de rumbo a mitad de camino.',
    parameters: {
      type: 'object',
      properties: {
        objetivo: { type: 'string', description: 'Qué se va a lograr, en una frase, en el idioma del usuario' },
        contexto: { type: 'string', description: 'Lo que encontraste al explorar el código que importa para el plan' },
        pasos: { type: 'array', items: { type: 'object', properties: { paso: { type: 'string' }, archivos: { type: 'array', items: { type: 'string' } } }, required: ['paso'] }, description: 'En orden de ejecución' },
        riesgos: { type: 'array', items: { type: 'string' }, description: 'Qué puede salir mal y cómo lo evitas' },
        alternativas: { type: 'array', items: { type: 'string' }, description: 'Otras formas que consideraste y por qué no' },
        pruebas: { type: 'array', items: { type: 'string' }, description: 'Cómo vas a demostrar que funciona (comandos, pruebas, pasos manuales)' },
      },
      required: ['objetivo', 'pasos', 'riesgos', 'pruebas'],
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    timeoutMs: (DEFAULTS.timeoutSegundos + 30) * 1000,
    async execute(args, exec) {
      const p = args ?? {}
      const faltan = []
      if (!String(p.objetivo ?? '').trim()) faltan.push('objetivo')
      if (!Array.isArray(p.pasos) || p.pasos.length < 1) faltan.push('pasos')
      if (!Array.isArray(p.riesgos) || !p.riesgos.length) faltan.push('riesgos (al menos uno)')
      if (!Array.isArray(p.pruebas) || !p.pruebas.length) faltan.push('pruebas (cómo lo vas a probar)')
      if (faltan.length) throw new Error(`Al plan le falta: ${faltan.join(', ')}.`)
      let s = estados.get(exec.agent)
      if (!s) { s = { pedido: '', grande: true, plan: null, esperando: false, revisiones: 0 }; estados.set(exec.agent, s) }
      const primera = !s.plan
      s.plan = p
      let archivo = ''
      try {
        const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
        archivo = path.join(cfg.carpeta, `${hoy()}-${slug(p.objetivo)}.md`)
        await mkdir(path.join(cwd, cfg.carpeta), { recursive: true })
        await writeFile(path.join(cwd, archivo), planMarkdown(p, s.pedido), 'utf8')
      } catch { archivo = '' }
      let revision = ''
      if (cfg.revisarPlan && s.revisiones < 1) {
        s.revisiones++
        try { revision = (await revisarPlan(exec.agent, exec.signal, p, s.pedido)) ?? '' } catch (e) { revision = `(No se pudo revisar el plan: ${e?.message ?? e})` }
      }
      if (cfg.esperarAprobacion && primera) s.esperando = true
      return [
        `Plan registrado${archivo ? ` en ${archivo.split(path.sep).join('/')}` : ''}: ${p.pasos.length} pasos, ${p.riesgos.length} riesgos, ${p.pruebas.length} pruebas.`,
        revision ? `\nObservaciones del arquitecto revisor (${cfg.revisor.model}):\n${revision}\n\nSi señala huecos reales, vuelve a llamar plan_crear con el plan ajustado (no habrá otra revisión). Si no, empieza.` : '',
        s.esperando
          ? '\nAhora muéstrale al usuario el plan (resumido, en lenguaje claro, con los riesgos) y PREGÚNTALE si sigues. No edites archivos hasta que responda.'
          : '\nYa puedes editar archivos. Sigue el plan paso a paso y pruébalo como dijiste.',
      ].filter(Boolean).join('\n')
    },
  })
}
