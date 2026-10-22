/**
 * Mimo speaks about the household's ficha (PRO-319, D-051, D-064, D-065,
 * D-110; specs/household-profile.md → «Mimo and the ficha», specs/advisor.md).
 *
 * «¿Qué sabes de mí?», «apunta que…», «olvida que…», «¿por qué crees que…?»,
 * «pausa lo que aprendes de mí», the pending question and «quiero proteína en
 * cada plato». Every tool calls the same «Tu ficha» routes as the screen, as
 * the user (appApi.ts), so the web chat, voice and WhatsApp see and change
 * exactly what the reader may in the app. The summaries are guidance for the
 * model, which writes the reply in its own words (D-065).
 *
 * Health: never written from WhatsApp, never shown on WhatsApp, and never
 * another person's health in a summary, on any channel.
 */
import {
  FICHA_FACTS_PATH,
  FICHA_PATH,
  FICHA_QUESTION_ASK_PATH,
  FICHA_TOPIC_LABELS,
  PROFILE_FACT_TYPES,
  isHealthProfileFactType,
  type FichaAskView,
  type FichaFactView,
  type FichaView,
  type FichaWhyView,
} from '@ona/shared'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import { WHATSAPP_HEALTH_DATA_REPLY, HEALTH_CONSENT_SKILL_REPLY } from '../healthConsent.js'
import { mentionsHealth, stripHealthFromWhatsAppText } from '../profile/healthText.js'
import { addDays, madridMidnightUtc } from '../madridTime.js'

const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })
const text = (summary: string, data: unknown = null): SkillResult => ({ data, summary, uiHint: 'text' })
const onWhatsApp = (ctx: SkillContext) => ctx.channel === 'whatsapp'
const CHILD_REPLY = 'No he cambiado nada: la ficha la ven y la cambian los adultos de la casa.'
const NO_HOUSEHOLD_REPLY = 'No he encontrado la ficha: esta cuenta todavía no tiene hogar.'

/** Common API errors as guidance for the model; anything else is a real error. */
function fichaError(err: unknown): SkillResult {
  if (err instanceof AppApiError) {
    if (err.status === 404 && /hogar/i.test(err.message)) return text(NO_HOUSEHOLD_REPLY)
    if (err.status === 403 && /adultos/i.test(err.message)) return text(CHILD_REPLY)
    if (err.status === 403 && /WhatsApp/i.test(err.message)) return text(WHATSAPP_HEALTH_DATA_REPLY)
    if (err.status === 403 && /consentimiento/i.test(err.message)) return text(HEALTH_CONSENT_SKILL_REPLY)
    return text(`No he cambiado nada: ${err.message}.`)
  }
  throw err
}

/**
 * Pure: may this fact appear in what Mimo tells this reader on this channel?
 * Never another person's health (a member's, or a person without an
 * account's), nor a note about someone else that talks about health; on
 * WhatsApp no health at all, not even the reader's own.
 */
export function fichaFactShareable(f: Pick<FichaFactView, 'health' | 'subjectKey' | 'sentence'>, readerId: string, channel: SkillContext['channel']): boolean {
  const mine = f.subjectKey === `u:${readerId}`
  if (channel === 'whatsapp') return !f.health && !mentionsHealth(f.sentence)
  if (f.health) return mine
  return mine || !mentionsHealth(f.sentence)
}

/** Pure: «¿qué sabes de mí?» as guidance for the model — portrait, then each person's facts by topic, with their ids. */
export function fichaSummary(view: FichaView, readerId: string, channel: SkillContext['channel']): string {
  const lines: string[] = []
  const portrait = view.portrait?.text ? stripHealthFromWhatsAppText(view.portrait.text).text.trim() : ''
  if (portrait) lines.push(`Retrato (lo escribes tú cada noche): ${portrait}`)
  const shareable = view.facts.filter((f) => fichaFactShareable(f, readerId, channel))
  const hiddenOwnHealth = channel === 'whatsapp' && view.facts.some((f) => f.health && f.subjectKey === `u:${readerId}`)
  for (const p of view.people) {
    const facts = shareable.filter((f) => f.subjectKey === p.key)
    if (!facts.length) continue
    lines.push(`${p.label}:`)
    for (const f of facts) {
      const extra = [f.originLabel, f.temporary ? 'temporal' : '', f.canEdit ? '' : 'solo lo cambia esa persona'].filter(Boolean).join('; ')
      lines.push(`- ${f.sentence} (${FICHA_TOPIC_LABELS[f.topic]}; ${extra}) [id ${f.id}]`)
    }
  }
  if (!portrait && !shareable.length) lines.push('La ficha está casi vacía: todavía sé muy poco de esta casa.')
  if (hiddenOwnHealth) lines.push('Sus datos de salud no los cuentes por WhatsApp: están en Tu ficha, en la web (/profile/ficha).')
  lines.push(view.learningPaused ? 'Aprender de lo que hace: EN PAUSA (lo que ya sabes se queda).' : 'Aprender de lo que hace: activo.')
  lines.push('Cuéntaselo con tus palabras y en pocas líneas, lo más útil primero, agrupado por persona; sin ids, sin tipos y sin porcentajes. Si quiere ver más, la ficha entera está en Perfil → Tu ficha (/profile/ficha). Los ids son para explain_ficha_fact y forget_ficha_fact.')
  return lines.join('\n')
}

/** Pure: the end of a Madrid day (AAAA-MM-DD) as an ISO instant, for «hasta el 2 de noviembre». */
export function endOfMadridDay(isoDate: string): string {
  return new Date(madridMidnightUtc(addDays(isoDate, 1)).getTime() - 1000).toISOString()
}

async function findFact(ctx: SkillContext, factId: string): Promise<{ view: FichaView; fact: FichaFactView | undefined }> {
  const view = await api(ctx)<FichaView>('GET', FICHA_PATH)
  return { view, fact: view.facts.find((f) => f.id === factId) }
}

export const getFichaSkill: SkillDefinition = {
  name: 'get_ficha',
  description:
    'Lee la ficha del hogar tal como la ve esta persona: el retrato, y lo que Mimoia sabe de la casa, de ella, de las demás personas y de quien vive sin cuenta (gustos, platos fijos, horarios, cocina, situaciones temporales…), con de dónde sale cada cosa. Úsalo cuando pregunte «¿qué sabes de mí?», «¿qué tienes apuntado de nosotros?», «¿qué sabes de mi casa?», o antes de olvidar o explicar algo de la ficha para saber su id. Nunca incluye la salud de otra persona; por WhatsApp no incluye salud.',
  parameters: { type: 'object', properties: {} },
  async handler(_p: unknown, ctx: SkillContext): Promise<SkillResult> {
    try {
      const view = await api(ctx)<FichaView>('GET', FICHA_PATH)
      return text(fichaSummary(view, ctx.userId, ctx.channel), { facts: view.facts.filter((f) => fichaFactShareable(f, ctx.userId, ctx.channel)).length })
    } catch (err) {
      return fichaError(err)
    }
  },
}

export const explainFichaFactSkill: SkillDefinition = {
  name: 'explain_ficha_fact',
  description:
    '«¿Por qué crees que…?», «¿de dónde sacas que…?»: las pruebas de un dato de la ficha (qué vio Mimoia y cuándo, cómo de seguro está y cómo lo usa). Necesita el id del dato (de get_ficha). Contesta en frases normales, con las fechas, sin porcentajes. Si el dato está mal, ofrece corregirlo (note_ficha_fact) u olvidarlo (forget_ficha_fact).',
  parameters: {
    type: 'object',
    properties: { fact_id: { type: 'string', description: 'El id del dato, tal como lo da get_ficha.' } },
    required: ['fact_id'],
  },
  async handler(p: { fact_id?: string }, ctx: SkillContext): Promise<SkillResult> {
    if (!p?.fact_id) return text('No he encontrado ese dato: llama antes a get_ficha para saber su id.')
    try {
      const { fact } = await findFact(ctx, p.fact_id)
      if (!fact || !fichaFactShareable(fact, ctx.userId, ctx.channel)) {
        return text(onWhatsApp(ctx) && fact?.health ? 'De salud no hablo por WhatsApp: en Tu ficha, en la web (/profile/ficha), está por qué lo sé.' : 'No he encontrado ese dato en su ficha.')
      }
      const why = await api(ctx)<FichaWhyView>('GET', `${FICHA_PATH}/facts/${encodeURIComponent(p.fact_id)}/why`)
      const clean = (s: string) => (onWhatsApp(ctx) ? stripHealthFromWhatsAppText(s).text : s)
      const lines = [
        `Dato: ${why.fact.sentence} (${why.fact.originLabel}; lo sé desde ${why.since}).`,
        why.confidence ? `Seguridad: ${why.confidence}.` : 'Lo dijo una persona de la casa: no es una deducción.',
        why.evidence.length ? 'Lo que vi:' : 'No guardo más pruebas que esa.',
        ...why.evidence.map((e) => `- ${e.date}: ${clean(e.text)}`),
        `Cómo lo uso: ${why.howIUse}`,
        why.fact.canEdit ? 'Puede corregirlo u olvidarlo.' : 'Es de otra persona de la casa: solo lo cambia ella desde su ficha.',
        'Explícalo en dos o tres frases con tus palabras.',
      ]
      return text(lines.join('\n'))
    } catch (err) {
      return fichaError(err)
    }
  },
}

export const noteFichaFactSkill: SkillDefinition = {
  name: 'note_ficha_fact',
  description:
    '«Apunta que…», «recuerda que en casa…», «quiero proteína en cada plato»: escribe en la ficha del hogar algo que la persona cuenta de sí misma, de la casa o de alguien que vive sin cuenta (por su apodo, «el abuelo», «la pequeña»). Úsalo para lo que no es memoria personal: plato fijo (fixed_dish {dish, days?, meal?}), comida que no se cocina (skipped_meal {days, meal, reason?}), cada cuánto un plato (dish_frequency {dish, minWeeks, maxWeeks}), afinidad (affinity {kind: ingredient|style, target, score -2..2}), esfuerzo (effort {days, meal, activeMinutes, totalMinutes}), situación temporal (temporary_situation {description} con valid_until: «sin horno hasta el 2 de noviembre»), compra (shopping {places?, days?, note?}), batch (batch_cooking {batches, days?, lunchboxes?}), gusto por lo nuevo (novelty {score -2..2}), notas (notes [texto]) y «proteína en cada plato» (protein_minimum {scope: "every_dish"}, siempre de quien lo pide: 80 g de carne, pescado o huevo por ración en todos los platos, entrantes y arroces o legumbres incluidos). Para los gustos, el equipo y los horarios propios sigue valiendo update_memory. Días: lunes…domingo sin tildes; comidas: breakfast, lunch, snack, dinner. Una lista (notes, dislikes) se suma a lo que ya hay. Por WhatsApp nunca se apunta nada de salud.',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...PROFILE_FACT_TYPES], description: 'Tipo de dato de la ficha.' },
      value: { description: 'El valor con la forma de su tipo (ver la descripción).' },
      about: { type: 'string', enum: ['me', 'household', 'person'], description: 'De quién es: me = quien habla, household = la casa entera, person = alguien sin cuenta (con person).' },
      person: { type: 'string', description: 'Solo con about=person: el apodo de esa persona tal como sale en get_ficha («el abuelo», «la pequeña»).' },
      valid_until: { type: 'string', description: 'Opcional, AAAA-MM-DD: hasta qué día vale (situaciones temporales).' },
    },
    required: ['type', 'value', 'about'],
  },
  async handler(p: { type?: string; value?: unknown; about?: string; person?: string; valid_until?: string }, ctx: SkillContext): Promise<SkillResult> {
    const type = String(p?.type ?? '')
    if (!(PROFILE_FACT_TYPES as readonly string[]).includes(type)) return text(`No he guardado nada: type tiene que ser uno de ${PROFILE_FACT_TYPES.join(', ')}.`)
    // Never health from WhatsApp (LEG-03): neither a health type nor a note that talks about it.
    if (onWhatsApp(ctx) && (isHealthProfileFactType(type) || mentionsHealth(JSON.stringify(p.value ?? '')))) return text(WHATSAPP_HEALTH_DATA_REPLY)
    const about = p.about === 'household' || p.about === 'person' ? p.about : 'me'
    if (p.valid_until && !/^\d{4}-\d{2}-\d{2}$/.test(p.valid_until)) return text('No he guardado nada: valid_until va como AAAA-MM-DD.')
    try {
      let personId: string | null = null
      if (about === 'person') {
        const view = await api(ctx)<FichaView>('GET', FICHA_PATH)
        const wanted = String(p.person ?? '').trim().toLowerCase()
        const person = view.people.find((x) => x.kind === 'person' && x.label.trim().toLowerCase() === wanted)
        if (!person) {
          const known = view.people.filter((x) => x.kind === 'person').map((x) => `«${x.label}»`)
          return text(`No he guardado nada: no hay nadie sin cuenta llamado «${p.person ?? ''}» en la casa${known.length ? ` (están ${known.join(', ')})` : ''}. Se añade en Perfil → Tu ficha → «+ Persona».`)
        }
        personId = person.key.slice(2)
      }
      const out = await api(ctx)<{ factId: string; action: 'added' | 'updated' | 'unchanged'; sentence: string | null }>('POST', FICHA_FACTS_PATH, {
        type, value: p.value, about, personId, validUntil: p.valid_until ? endOfMadridDay(p.valid_until) : undefined,
      })
      const what = out.sentence ? `«${out.sentence}»` : 'el dato'
      return {
        data: out,
        summary: out.action === 'unchanged'
          ? `Ya lo tenía así en la ficha: ${what}. No he cambiado nada.`
          : `Apuntado en la ficha (${out.action === 'added' ? 'nuevo' : 'actualizado'}): ${what}. Lo dijo esta persona, así que manda sobre lo que Mimoia deduzca.${type === 'protein_minimum' ? ' Desde el próximo menú, cada plato de la casa lleva su ración de proteína.' : ''}`,
        uiHint: 'confirmation',
      }
    } catch (err) {
      return fichaError(err)
    }
  },
}

export const forgetFichaFactSkill: SkillDefinition = {
  name: 'forget_ficha_fact',
  description:
    '«Olvida que…», «eso ya no es así», «ya no quiero proteína en cada plato»: quita un dato de la ficha (necesita su id, de get_ficha). Mimoia no lo vuelve a apuntar sin preguntar. Solo lo de la casa, lo suyo o lo de alguien sin cuenta: lo de otra persona de la casa lo cambia ella.',
  parameters: {
    type: 'object',
    properties: { fact_id: { type: 'string', description: 'El id del dato, tal como lo da get_ficha.' } },
    required: ['fact_id'],
  },
  async handler(p: { fact_id?: string }, ctx: SkillContext): Promise<SkillResult> {
    if (!p?.fact_id) return text('No he olvidado nada: llama antes a get_ficha para saber el id del dato.')
    try {
      const { fact } = await findFact(ctx, p.fact_id)
      if (!fact) return text('No he olvidado nada: ese dato ya no está en su ficha.')
      if (onWhatsApp(ctx) && (fact.health || mentionsHealth(fact.sentence))) return text('No he olvidado nada: lo de salud se cambia en Tu ficha, en la web (/profile/ficha), no por WhatsApp.')
      if (!fact.canEdit) return text('No he olvidado nada: es de otra persona de la casa y solo lo cambia ella desde su ficha.')
      await api(ctx)('DELETE', `${FICHA_PATH}/facts/${encodeURIComponent(p.fact_id)}`)
      return { data: { factId: p.fact_id }, summary: `Olvidado: «${fact.sentence}». No lo volveré a apuntar sin preguntar.`, uiHint: 'confirmation' }
    } catch (err) {
      return fichaError(err)
    }
  },
}

export const setFichaLearningSkill: SkillDefinition = {
  name: 'set_ficha_learning',
  description:
    '«Pausa lo que aprendes de mí», «deja de aprender de lo que hago», «vuelve a aprender»: el interruptor «Aprender de lo que hago» de esta persona (solo la suya). En pausa, Mimoia deja de deducir cosas de lo que hace; lo que ya sabe se queda y lo que la persona diga se sigue apuntando.',
  parameters: {
    type: 'object',
    properties: { paused: { type: 'boolean', description: 'true = en pausa; false = vuelve a aprender.' } },
    required: ['paused'],
  },
  async handler(p: { paused?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    if (typeof p?.paused !== 'boolean') return text('No he cambiado nada: paused tiene que ser true o false.')
    try {
      const out = await api(ctx)<{ paused: boolean }>('PUT', `${FICHA_PATH}/learning`, { paused: p.paused })
      return {
        data: out,
        summary: out.paused
          ? 'En pausa: ya no aprendo de lo que hace. Lo que ya sé se queda (lo puede ver u olvidar en Tu ficha) y lo que me diga lo sigo apuntando.'
          : 'Reanudado: vuelvo a aprender de lo que hace, cada noche.',
        uiHint: 'confirmation',
      }
    } catch (err) {
      return fichaError(err)
    }
  },
}

export const getFichaQuestionSkill: SkillDefinition = {
  name: 'get_ficha_question',
  description:
    'La pregunta pendiente de la ficha (algo que Mimoia sospecha y quiere confirmar, «¿seguís sin horno?»). Como mucho una a la semana por persona y, por WhatsApp, solo dentro de las 24 h desde su último mensaje: la herramienta lo comprueba y la marca como hecha. Llámalo solo si el contexto dice que hay una pendiente y en un momento natural (al enseñar el menú, al cerrar algo), nunca en medio de otra tarea.',
  parameters: { type: 'object', properties: {} },
  async handler(_p: unknown, ctx: SkillContext): Promise<SkillResult> {
    try {
      const out = await api(ctx)<FichaAskView>('POST', FICHA_QUESTION_ASK_PATH)
      if (!out.question) {
        const why = out.reason === 'weekly_cap' ? 'ya le has hecho una esta semana' : out.reason === 'outside_window' ? 'por WhatsApp solo se pregunta dentro de las 24 h desde su último mensaje' : 'no hay ninguna pendiente'
        return text(`No hay pregunta que hacer ahora (${why}). No preguntes nada de la ficha.`, out)
      }
      return text(
        `Pregunta pendiente [id ${out.question.id}]: «${out.question.question}». Hazla con tus palabras, una sola vez y al final de tu respuesta, con [[opciones: Sí | No | Ahora no]]. Cuando conteste, llama a answer_ficha_question con ese id.`,
        out,
      )
    } catch (err) {
      return fichaError(err)
    }
  },
}

export const answerFichaQuestionSkill: SkillDefinition = {
  name: 'answer_ficha_question',
  description:
    'Guarda la respuesta a la pregunta pendiente de la ficha (la de get_ficha_question): yes = «Sí» (el dato se confirma), no = «No» (se olvida), later = «Ahora no» (se vuelve a preguntar en una semana como pronto). Lo mismo que los botones de Tu ficha.',
  parameters: {
    type: 'object',
    properties: {
      question_id: { type: 'string', description: 'El id que dio get_ficha_question.' },
      answer: { type: 'string', enum: ['yes', 'no', 'later'] },
    },
    required: ['question_id', 'answer'],
  },
  async handler(p: { question_id?: string; answer?: string }, ctx: SkillContext): Promise<SkillResult> {
    if (!p?.question_id || !['yes', 'no', 'later'].includes(String(p.answer))) return text('No he guardado nada: hacen falta question_id y answer (yes, no o later).')
    try {
      await api(ctx)('POST', `${FICHA_PATH}/questions/${encodeURIComponent(p.question_id)}`, { answer: p.answer })
      const said = p.answer === 'yes' ? 'Confirmado en la ficha.' : p.answer === 'no' ? 'Olvidado de la ficha.' : 'Vale, se lo vuelvo a preguntar más adelante.'
      return { data: { answer: p.answer }, summary: said, uiHint: 'confirmation' }
    } catch (err) {
      if (err instanceof AppApiError && err.status === 404 && !/hogar/i.test(err.message)) return text('No he guardado nada: esa pregunta ya está contestada.')
      return fichaError(err)
    }
  },
}

export const fichaSkills: SkillDefinition[] = [
  getFichaSkill,
  explainFichaFactSkill,
  noteFichaFactSkill,
  forgetFichaFactSkill,
  setFichaLearningSkill,
  getFichaQuestionSkill,
  answerFichaQuestionSkill,
]
