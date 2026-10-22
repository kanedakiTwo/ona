/**
 * PRO-317 (D-064, D-110) — «Tu ficha» as its reader sees it. Pure: the
 * routes load the rows (fichaStore.ts) and this turns them into the screen's
 * shape (`FichaView` in @ona/shared): one sentence per fact in Spanish, for
 * whoever reads it («Te encanta la cuchara», «No os gusta el cilantro»), its
 * topic, where it comes from, and what the reader may do with it.
 */
import {
  COOKING_STYLE_LABELS,
  SPANISH_REGIONS,
  fichaConfidenceWord,
  formatDayTimeBudget,
  isHealthProfileFactType,
  isCookingStyle,
  toDayTimeBudget,
  type FichaChangeView,
  type FichaFactView,
  type FichaOrigin,
  type FichaPersonView,
  type FichaTopic,
} from '@ona/shared'
import { madridParts } from '../madridTime.js'
import { equipmentMissingIn } from './reader.js'
import { sameFactValue } from './writer.js'

/** Who a sentence is about, from the reader's side. */
export type Who = 'tu' | 'casa' | 'otra'

const DAY: Record<string, string> = { lunes: 'lunes', martes: 'martes', miercoles: 'miércoles', jueves: 'jueves', viernes: 'viernes', sabado: 'sábado', domingo: 'domingo' }
const DAY_PLURAL: Record<string, string> = { lunes: 'lunes', martes: 'martes', miercoles: 'miércoles', jueves: 'jueves', viernes: 'viernes', sabado: 'sábados', domingo: 'domingos' }
const MEAL: Record<string, string> = { breakfast: 'el desayuno', lunch: 'la comida', snack: 'la merienda', dinner: 'la cena' }
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [])
/** «a, b y c». */
export function joinEs(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}
const days = (d: unknown) => joinEs(list(d).map((x) => DAY_PLURAL[x] ?? x))
export function dateEs(d: Date): string {
  const [, month, day] = madridParts(d).isoDate.split('-').map(Number)
  return `${day} de ${MONTHS[month - 1]}`
}

/** Verb forms per reader: tú · vosotros (the household) · él/ella (another person). */
const V = {
  gusta: { tu: 'te gusta', casa: 'os gusta', otra: 'le gusta' },
  encanta: { tu: 'te encanta', casa: 'os encanta', otra: 'le encanta' },
  tener: { tu: 'tienes', casa: 'tenéis', otra: 'tiene' },
  cocinar: { tu: 'cocinas', casa: 'cocináis', otra: 'cocina' },
  comprar: { tu: 'compras', casa: 'compráis', otra: 'compra' },
  preferir: { tu: 'prefieres', casa: 'preferís', otra: 'prefiere' },
  vivir: { tu: 'vives', casa: 'vivís', otra: 'vive' },
  da_igual: { tu: 'te da igual', casa: 'os da igual', otra: 'le da igual' },
} as const

/** Pure: one fact as a sentence for its reader, or null when there is nothing to say. */
export function factSentence(type: string, value: unknown, who: Who, validUntil: Date | null = null): string | null {
  const v = (value ?? {}) as Record<string, any>
  const until = validUntil ? ` hasta el ${dateEs(validUntil)}` : ''
  switch (type) {
    case 'fixed_dish': {
      if (!v.dish) return null
      const when = [v.days ? `los ${days(v.days)}` : '', v.meal ? `en ${MEAL[v.meal] ?? v.meal}` : ''].filter(Boolean).join(' ')
      return cap(`${v.dish}${when ? ` ${when}` : ''}`)
    }
    case 'skipped_meal':
      return cap(`los ${days(v.days)} no se cocina ${MEAL[v.meal] ?? 'esa comida'}${v.reason ? ` (${v.reason})` : ''}`)
    case 'dish_frequency':
      return v.dish ? cap(`${v.dish} cada ${v.minWeeks === v.maxWeeks ? v.minWeeks : `${v.minWeeks} o ${v.maxWeeks}`} semanas`) : null
    case 'affinity': {
      if (!v.target) return null
      const s = Number(v.score)
      const t = String(v.target)
      if (s >= 2) return cap(`${V.encanta[who]} ${t}`)
      if (s === 1) return cap(`${V.gusta[who]} ${t}`)
      if (s === 0) return cap(`${t} ${V.da_igual[who]}`)
      if (s === -1) return cap(`${t}, mejor poco`)
      return cap(`${t}, mejor no`)
    }
    case 'effort':
      return cap(`los ${days(v.days)}, ${MEAL[v.meal] ?? 'esa comida'} con ${v.activeMinutes} minutos de trabajo${v.totalMinutes > v.activeMinutes ? `, aunque luego cueza más (${v.totalMinutes} en total)` : ''}`)
    case 'temporary_situation':
      return v.description ? cap(`${String(v.description).replace(/\.$/, '')}${until}`) : null
    case 'shopping': {
      const parts = [list(v.places).length ? `${V.comprar[who]} en ${joinEs(list(v.places))}` : '', list(v.days).length ? `los ${days(v.days)}` : '', v.note ?? ''].filter(Boolean)
      return parts.length ? cap(parts.join(', ')) : null
    }
    case 'batch_cooking': {
      if (!v.batches) return cap(`no ${V.cocinar[who]} por tandas`)
      const dejar = { tu: 'dejas', casa: 'dejáis', otra: 'deja' }[who]
      return cap(`${V.cocinar[who]} por tandas${list(v.days).length ? ` los ${days(v.days)}` : ''}${v.lunchboxes ? ` y ${dejar} táperes` : ''}`)
    }
    case 'novelty': {
      const s = Number(v.score)
      if (s > 0) return cap(`${V.gusta[who]} probar cosas nuevas${s === 1 ? ', sin pasarse' : ''}`)
      if (s < 0) return cap(`${V.preferir[who]} la rutina`)
      return null
    }
    case 'cooking_style':
      return isCookingStyle(v.style) ? COOKING_STYLE_LABELS[v.style as keyof typeof COOKING_STYLE_LABELS] : null
    case 'protein_minimum':
      return 'Proteína en cada plato: al menos 80 g de carne, pescado o huevo por ración, también en los entrantes y en los platos de arroz, legumbre o pasta'
    case 'dislikes':
      return list(value).length ? cap(`no ${V.gusta[who]} ${joinEs(list(value))}`) : null
    case 'equipment':
      return list(value).length ? cap(`${V.tener[who]} ${joinEs(list(value))}`) : null
    case 'notes':
      return list(value).length ? list(value).join('. ') : null
    case 'prep_habits':
      return list(value).length ? list(value).join('. ') : null
    case 'nutrition_principles':
      return list(value).length ? `${who === 'tu' ? 'Tus principios' : who === 'casa' ? 'Vuestros principios' : 'Sus principios'}: ${joinEs(list(value).map((x) => x.replace(/\.$/, '')))}` : null
    case 'cooking_skill':
      return `Nivel de cocina: ${({ easy: 'fácil', medium: 'medio', advanced: 'avanzado' } as Record<string, string>)[String(value)] ?? String(value)}`
    case 'weekly_budget_eur':
      return `Presupuesto: ${value} € a la semana`
    case 'household.adults':
      return `${value} ${Number(value) === 1 ? 'adulto' : 'adultos'} en casa`
    case 'household.kids_2_to_10':
      return Number(value) > 0 ? `${value} ${Number(value) === 1 ? 'niño' : 'niños'} de 2 a 10 años` : 'Ningún niño de 2 a 10 años'
    case 'region':
      return SPANISH_REGIONS[String(value) as keyof typeof SPANISH_REGIONS] ? cap(`${V.vivir[who]} en ${SPANISH_REGIONS[String(value) as keyof typeof SPANISH_REGIONS]}`) : null
    case 'time_available': {
      const parts = Object.entries((value ?? {}) as Record<string, unknown>)
        .map(([d, raw]) => { const b = toDayTimeBudget(raw); return b ? `${DAY[d] ?? d} ${formatDayTimeBudget(b)}` : null })
        .filter((x): x is string => !!x)
      return parts.length ? `Tiempo para cocinar: ${parts.join(', ')}` : null
    }
    case 'meal_times': {
      const parts = Object.entries((value ?? {}) as Record<string, string>).map(([m, t]) => `${(MEAL[m] ?? m).replace(/^(el|la) /, '')} a las ${t}`)
      return parts.length ? `Horarios: ${parts.join(', ')}` : null
    }
    case 'cuisine_bias': {
      const parts = Object.entries((value ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([c]) => c)
      return parts.length ? `Cocinas preferidas: ${joinEs(parts)}` : null
    }
    case 'restrictions':
      return list(value).length ? cap(joinEs(list(value))) : null
    case 'physical.sex':
      return `Sexo: ${({ male: 'hombre', female: 'mujer', other: 'otro' } as Record<string, string>)[String(value)] ?? String(value)}`
    case 'physical.age':
      return `Edad: ${value} años`
    case 'physical.height_cm':
      return `Altura: ${value} cm`
    case 'physical.weight_kg':
      return `Peso: ${value} kg`
    case 'physical.activity_level':
      return `Actividad física: ${({ none: 'ninguna', light: 'ligera', moderate: 'moderada', high: 'alta' } as Record<string, string>)[String(value)] ?? String(value)}`
    default:
      return null
  }
}

const TOPIC_OF: Record<string, FichaTopic> = {
  fixed_dish: 'como_comeis', skipped_meal: 'como_comeis', dish_frequency: 'como_comeis', meal_times: 'como_comeis', cooking_style: 'como_comeis',
  equipment: 'en_la_cocina', temporary_situation: 'en_la_cocina', batch_cooking: 'en_la_cocina', cooking_skill: 'en_la_cocina', prep_habits: 'en_la_cocina',
  time_available: 'tiempo_y_compra', effort: 'tiempo_y_compra', shopping: 'tiempo_y_compra', weekly_budget_eur: 'tiempo_y_compra',
  affinity: 'gustos', dislikes: 'gustos', novelty: 'gustos', cuisine_bias: 'gustos',
  protein_minimum: 'como_comes', nutrition_principles: 'como_comes',
  'household.adults': 'la_casa', 'household.kids_2_to_10': 'la_casa', region: 'la_casa',
  notes: 'notas',
}

/** Pure: the topic a fact type is shown in. */
export function factTopic(type: string): FichaTopic {
  if (isHealthProfileFactType(type)) return 'salud'
  return TOPIC_OF[type] ?? 'notas'
}

/** Pure: «Cómo lo uso», only what the code really does with the fact. */
export function howIUse(type: string, value: unknown): string {
  if (isHealthProfileFactType(type)) {
    return type === 'restrictions'
      ? 'El menú nunca te propone nada que lo incumpla, y Mimo lo tiene presente cuando te sugiere platos.'
      : 'Lo uso para calcular cuánto conviene comer en cada plato.'
  }
  switch (type) {
    case 'dislikes':
      return 'El menú no te propone platos con eso.'
    case 'affinity':
      return Number((value as any)?.score) <= -2
        ? 'El menú no te propone platos con eso, y Mimo lo tiene en cuenta cuando te sugiere algo.'
        : 'Mimo lo tiene en cuenta cuando te propone cambios y recetas.'
    case 'equipment':
      return 'El menú solo te propone recetas que puedes hacer con lo que tenéis.'
    case 'temporary_situation': {
      const missing = equipmentMissingIn(String((value as any)?.description ?? ''))
      return missing.length
        ? `Mientras tanto no te propongo nada que necesite ${joinEs(missing)}.`
        : 'Mimo lo tiene en cuenta mientras dure.'
    }
    case 'protein_minimum':
      return 'El menú de tu casa pide esos 80 g también en los entrantes y en los platos de arroz, legumbre o pasta.'
    case 'time_available':
      return 'El menú no te propone recetas que necesiten más tiempo del que tienes ese día.'
    case 'household.adults':
    case 'household.kids_2_to_10':
      return 'Con esto calculo las raciones y la lista de la compra.'
    case 'region':
      return 'Los festivos de tu comunidad cuentan como fin de semana en el menú.'
    default:
      return 'Mimo lo tiene en cuenta cuando habla contigo y cuando te propone cambios.'
  }
}

/** Pure: the reader's words for where a fact comes from. */
export function factOrigin(origin: string, actorUserId: string | null, viewerId: string, names: Record<string, string>): { origin: FichaOrigin; label: string } {
  if (origin === 'onboarding') return { origin: 'alta', label: 'Del alta' }
  if (origin === 'user') {
    if (!actorUserId || actorUserId === viewerId) return { origin: 'tu', label: 'Lo dijiste tú' }
    return { origin: 'otra_persona', label: `Lo dijo ${names[actorUserId] ?? 'alguien de casa'}` }
  }
  return { origin: 'deducido', label: 'Lo he deducido' }
}

export interface FactRow {
  id: string
  subjectUserId: string | null
  subjectPersonId: string | null
  type: string
  value: unknown
  origin: string
  confidence: number
  evidence: unknown
  validUntil: Date | null
  status: string
  createdAt: Date
  updatedAt: Date
}

export function subjectKey(f: Pick<FactRow, 'subjectUserId' | 'subjectPersonId'>): string {
  return f.subjectUserId ? `u:${f.subjectUserId}` : f.subjectPersonId ? `p:${f.subjectPersonId}` : 'casa'
}

/** The reader may change a fact about the household, about themselves or about a person without an account. */
export function canEditFact(f: Pick<FactRow, 'subjectUserId'>, viewerId: string, viewerRole: string): boolean {
  if (viewerRole === 'child') return false
  return f.subjectUserId === null || f.subjectUserId === viewerId
}

/** Pure: one stored fact as the screen shows it, or null when it says nothing. */
export function factView(f: FactRow, ctx: { viewerId: string; viewerRole: string; actorUserId: string | null; names: Record<string, string> }): FichaFactView | null {
  const who: Who = f.subjectUserId === ctx.viewerId ? 'tu' : f.subjectUserId || f.subjectPersonId ? 'otra' : 'casa'
  const sentence = factSentence(f.type, f.value, who, f.type === 'temporary_situation' ? f.validUntil : null)
  if (!sentence) return null
  const o = factOrigin(f.origin, ctx.actorUserId, ctx.viewerId, ctx.names)
  return {
    id: f.id,
    subjectKey: subjectKey(f),
    type: f.type,
    topic: factTopic(f.type),
    sentence,
    origin: o.origin,
    originLabel: o.label,
    temporary: f.type === 'temporary_situation' || !!f.validUntil,
    validUntil: f.validUntil ? f.validUntil.toISOString() : null,
    health: isHealthProfileFactType(f.type),
    canEdit: canEditFact(f, ctx.viewerId, ctx.viewerRole),
    updatedAt: f.updatedAt.toISOString(),
  }
}

/** Pure: «La casa» first, then the reader, the other members and the people without an account. */
export function peopleView(
  viewerId: string,
  viewerRole: string,
  members: Array<{ userId: string; name: string }>,
  persons: Array<{ id: string; alias: string; ageBand: string }>,
): FichaPersonView[] {
  const out: FichaPersonView[] = [{ key: 'casa', kind: 'household', label: 'La casa', ageBand: null, isViewer: false, canEdit: false }]
  const me = members.find((m) => m.userId === viewerId)
  if (me) out.push({ key: `u:${me.userId}`, kind: 'user', label: 'Tú', ageBand: null, isViewer: true, canEdit: false })
  for (const m of members) if (m.userId !== viewerId) out.push({ key: `u:${m.userId}`, kind: 'user', label: m.name, ageBand: null, isViewer: false, canEdit: false })
  for (const p of persons) out.push({ key: `p:${p.id}`, kind: 'person', label: cap(p.alias), ageBand: p.ageBand, isViewer: false, canEdit: viewerRole !== 'child' })
  return out
}

export interface ChangeRow {
  id: string
  factId: string | null
  action: string
  factType: string | null
  before: unknown
  after: unknown
  origin: string
  actorUserId: string | null
  createdAt: Date
}

const AI_ORIGINS = new Set(['ai_realtime', 'ai_nightly', 'ai_weekly'])

/** Pure: one history row as the reader sees it, or null when it isn't for them. */
export function changeView(c: ChangeRow, fact: FactRow | undefined, viewerId: string, currentPortrait: string | null = null): FichaChangeView | null {
  const byMimo = AI_ORIGINS.has(c.origin)
  if (c.action === 'portrait_updated') {
    const after = (c.after as { portrait?: string } | null)?.portrait
    const canUndo = byMimo && !!(c.before as any)?.portrait && (currentPortrait === null || after === currentPortrait)
    return { id: c.id, factId: null, at: c.createdAt.toISOString(), action: 'portrait', verb: 'He reescrito', sentence: 'El retrato de tu casa', byMimo, canUndo }
  }
  if (!c.factType || !fact) return null
  const who: Who = fact.subjectUserId === viewerId ? 'tu' : fact.subjectUserId || fact.subjectPersonId ? 'otra' : 'casa'
  const valueOf = (x: unknown) => (x && typeof x === 'object' && 'value' in (x as object) ? (x as any).value : x)
  const value = c.action === 'fact_retired' ? valueOf(c.before) : valueOf(c.after) ?? fact.value
  const sentence = factSentence(c.factType, value, who)
  if (!sentence) return null
  const action = c.action === 'fact_added' ? 'added' : c.action === 'fact_retired' ? 'retired' : c.action === 'fact_updated' ? 'updated' : null
  if (!action) return null
  // Undo only while the fact is still as Mimo left it (else the API answers 409).
  const stillThere = action === 'added' ? fact.status === 'active'
    : action === 'retired' ? fact.status !== 'active'
      : fact.status === 'active' && sameFactValue(fact.value, valueOf(c.after))
  const mine = !byMimo && (c.actorUserId === viewerId || c.actorUserId === null)
  const verb = byMimo
    ? { added: 'He apuntado', updated: 'He cambiado', retired: 'He dejado de pensar' }[action]
    : mine
      ? { added: 'Lo dijiste tú', updated: 'Corregiste', retired: 'Olvidaste' }[action]
      : { added: 'Lo apuntó alguien de casa', updated: 'Lo cambió alguien de casa', retired: 'Lo olvidó alguien de casa' }[action]
  return { id: c.id, factId: fact.id, at: c.createdAt.toISOString(), action, verb, sentence, byMimo, canUndo: byMimo && stillThere }
}

/** Pure: the confidence word, only for what Mimo deduced. */
export function confidenceFor(f: Pick<FactRow, 'origin' | 'confidence'>): string | null {
  return AI_ORIGINS.has(f.origin) ? fichaConfidenceWord(f.confidence) : null
}
