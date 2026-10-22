/**
 * «Afina tu menú» from chat (PRO-297, D-051; specs/taste.md, specs/advisor.md):
 * see and forget the user's verdicts («Me apetece», «Me encanta», «No para
 * mí», «No la conozco»). Same routes as «Editar mis datos uno a uno» in the
 * ficha (`GET /taste/verdicts`, `DELETE /taste/:recipeId`), called as the user
 * (appApi.ts), so the web chat, voice and WhatsApp land on the same rows.
 *
 * Origin: the PRO-205 notice told households «díselo a Mimo» and Mimo
 * answered «Esos "Me apetece" no los puedo deshacer desde el chat» (Dani y
 * Sara, 2026-10-20).
 */
import type { TasteVerdict, TasteVerdictRow } from '@ona/shared'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { appApiFor, type AppApi } from './appApi.js'

const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })
const text = (summary: string, data: unknown = null): SkillResult => ({ data, summary, uiHint: 'text' })

export const VERDICT_LABELS: Record<TasteVerdict, string> = {
  love: 'Me encanta',
  like: 'Me apetece',
  nope: 'No para mí',
  skip: 'No la conozco',
}
const VERDICTS = Object.keys(VERDICT_LABELS) as TasteVerdict[]
const isVerdict = (v: unknown): v is TasteVerdict => typeof v === 'string' && (VERDICTS as string[]).includes(v)

const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Pure: which rated recipes a name the user said points to. An exact name
 * wins; otherwise every recipe whose name contains it («la pizza» → «Pizza
 * margarita»), or that it contains.
 */
export function matchVerdicts(rows: TasteVerdictRow[], name: string): TasteVerdictRow[] {
  const q = fold(name).replace(/^(el|la|los|las|un|una|unos|unas) /, '')
  if (!q) return []
  const exact = rows.filter((r) => fold(r.name) === q)
  if (exact.length) return exact
  return rows.filter((r) => {
    const n = fold(r.name)
    return n.includes(q) || (q.length >= 6 && q.includes(n))
  })
}

async function loadRows(ctx: SkillContext): Promise<TasteVerdictRow[]> {
  const out = await api(ctx)<{ verdicts: TasteVerdictRow[] }>('GET', '/taste/verdicts')
  return out?.verdicts ?? []
}

export const listTasteVerdictsSkill: SkillDefinition = {
  name: 'list_taste_verdicts',
  description:
    'Lista las recetas que el usuario ha valorado en «Afina tu menú» (las cartas de recetas): «Me encanta», «Me apetece», «No para mí» y «No la conozco», de la mas reciente a la mas antigua. Usala cuando pregunte que ha valorado, que «Me apetece» dio, o antes de quitar alguna (por ejemplo, tras el aviso de la app de que la pantalla pudo enseñar platos que no encajan con sus alergias o su dieta). Son las de SU cuenta; las de otra persona del hogar las ve ella. Es lo mismo que Perfil → «Tu ficha» → «Editar mis datos uno a uno» → «Afina tu menú».',
  parameters: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: VERDICTS, description: 'Solo las de esta valoracion (like = «Me apetece»). Sin el, todas.' },
    },
    required: [],
  },
  async handler(p: { verdict?: string }, ctx: SkillContext): Promise<SkillResult> {
    const rows = await loadRows(ctx)
    const wanted = isVerdict(p?.verdict) ? rows.filter((r) => r.verdict === p.verdict) : rows
    if (!wanted.length) {
      return text(
        isVerdict(p?.verdict)
          ? `No tiene ninguna receta con «${VERDICT_LABELS[p.verdict]}» en «Afina tu menú».`
          : 'No ha valorado ninguna receta en «Afina tu menú» todavía.',
        { verdicts: [] },
      )
    }
    const lines = wanted.map((r) => `- ${r.name}: «${VERDICT_LABELS[r.verdict]}» (${r.updatedAt.slice(0, 10)})`)
    return text(`Recetas valoradas en «Afina tu menú» (${wanted.length}):\n${lines.join('\n')}`, { verdicts: wanted })
  },
}

export const forgetTasteVerdictsSkill: SkillDefinition = {
  name: 'forget_taste_verdicts',
  description:
    'Quita (olvida) valoraciones de «Afina tu menú»: la receta deja de contar como «Me apetece», «Me encanta» o «No para mí» para el menu, igual que «Olvidar» en Perfil → «Tu ficha» → «Editar mis datos uno a uno». Usala cuando pida quitar o deshacer un «Me apetece» (por ejemplo, de un plato que no puede comer) o cualquier otra valoracion. Pasa los nombres tal como salen en list_taste_verdicts (o como los diga el usuario); con all=true quita todas (o todas las de verdict). Solo toca las de su cuenta.',
  parameters: {
    type: 'object',
    properties: {
      names: { type: 'array', items: { type: 'string' }, description: 'Nombres de las recetas valoradas que quiere quitar.' },
      verdict: { type: 'string', enum: VERDICTS, description: 'Solo las de esta valoracion (like = «Me apetece»).' },
      all: { type: 'boolean', description: 'true = todas (o todas las de verdict). Solo si lo pide asi.' },
    },
    required: [],
  },
  async handler(p: { names?: string[]; verdict?: string; all?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    const names = Array.isArray(p?.names) ? p.names.filter((n) => typeof n === 'string' && n.trim()) : []
    if (!names.length && p?.all !== true) return text('No he quitado nada: dime que recetas (names) o all=true.')
    const all = await loadRows(ctx)
    const rows = isVerdict(p?.verdict) ? all.filter((r) => r.verdict === p.verdict) : all
    const picked = new Map<string, TasteVerdictRow>()
    const missing: string[] = []
    if (p?.all === true && !names.length) for (const r of rows) picked.set(r.recipeId, r)
    for (const n of names) {
      const found = matchVerdicts(rows, n)
      if (!found.length) missing.push(n)
      for (const r of found) picked.set(r.recipeId, r)
    }
    const removed: TasteVerdictRow[] = []
    for (const r of picked.values()) {
      await api(ctx)('DELETE', `/taste/${r.recipeId}`)
      removed.push(r)
    }
    const parts: string[] = []
    if (removed.length) {
      parts.push(`Quitado de «Afina tu menú»:\n${removed.map((r) => `- ${r.name} (era «${VERDICT_LABELS[r.verdict]}»)`).join('\n')}`)
    }
    // With something removed, the misses don't say «No he…» (NO_CHANGE_RE would read the call as no change).
    if (missing.length) parts.push(`${removed.length ? 'Sin valoracion que coincida' : 'No he encontrado entre sus valoraciones'}: ${missing.join(', ')}.`)
    if (!removed.length && !missing.length) parts.push('No he quitado nada: no tiene valoraciones que quitar.')
    return { data: { removed: removed.map((r) => r.recipeId), missing }, summary: parts.join('\n'), uiHint: removed.length ? 'confirmation' : 'text' }
  },
}

export const tasteSkills: SkillDefinition[] = [listTasteVerdictsSkill, forgetTasteVerdictsSkill]
