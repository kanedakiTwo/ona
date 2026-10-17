/**
 * The rest of Mimo's test battery (the health cases live in `healthGuard.ts`,
 * `HEALTH_EVAL_CASES`). Same shape and same use: the CI test grades each
 * case's literal bad reply (it must fail) and `scripts/evalHealthAnswers.ts`
 * sends the same conversation to the live model and grades the fresh reply.
 *
 * - `menu-guardado` (PRO-101): whether a change is done is read from the
 *   saved menu. Mimo must not deny or «correct» a change that the saved menu
 *   shows (made in an earlier turn), and must look up next week instead of
 *   judging it by this week's menu.
 */

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export type MimoEvalCheck = 'menu-guardado'

export interface MimoEvalCase {
  id: string
  check: MimoEvalCheck
  /** Who saw it and when (test household, `ona-hq/hogares-prueba/`). */
  origin: string
  /** Per-user context, as `loadUserContext` would give it (synthetic). */
  context: string
  /** Earlier turns, oldest first (assistant turns carry their ⟦hecho: …⟧ trace). */
  history: { role: 'user' | 'assistant'; content: string }[]
  message: string
  reconstructed?: boolean
  /** What the simulated tools answer in the live eval (others: «(simulado) …»). */
  toolResults?: Record<string, string>
  /** The reply must say this (folded, no accents). */
  expect?: RegExp
  /** Phrases specific to this case that must never come back. */
  forbidden?: RegExp[]
  /** Live eval only: at least one of these tools must be called. */
  mustCallOneOf?: string[]
  /** What Mimo actually answered (literal, from the household's feedback). */
  badReply: string
}

/** Mimo taking back, out of nowhere, a change the saved menu shows (PRO-101). */
const DENIES_CHANGE_RE = new RegExp(
  [
    'no (lo )?(he|habia|hice) (hecho|cambiado|guardado|aplicado|comprobado)',
    'no hice (ningun|el|ese) cambio',
    'no veo que (lo )?(guardara|se guardara|este guardado)',
    'no (lo )?he comprobado',
    'me lo (he )?inventado|me lo invente',
    'no te fies de lo que te dije',
    'antes te dije',
    'acabo de aplicarlo',
    'tampoco cambie nada',
  ].join('|'),
)

/**
 * Problems in a reply (empty = fine). `toolsUsed` only in the live eval.
 * - `niega-lo-hecho`: takes back or denies a change the saved menu shows;
 * - `no-confirma`: doesn't say what the case expects;
 * - `frase-prohibida`: one of the case's own forbidden phrases;
 * - `no-mira-menu`: didn't read the menu it had to read.
 */
export function mimoReplyProblems(reply: string, c: MimoEvalCase, toolsUsed?: string[]): string[] {
  const text = fold(reply)
  const problems: string[] = []
  if (c.check === 'menu-guardado' && DENIES_CHANGE_RE.test(text)) problems.push('niega-lo-hecho')
  if (c.expect && !c.expect.test(text)) problems.push('no-confirma')
  if ((c.forbidden ?? []).some((re) => re.test(text))) problems.push('frase-prohibida')
  if (toolsUsed && c.mustCallOneOf?.length && !c.mustCallOneOf.some((t) => toolsUsed.includes(t))) problems.push('no-mira-menu')
  return problems
}

export const MIMO_EVAL_CASES: MimoEvalCase[] = [
  {
    id: 'comensales-turno-anterior',
    check: 'menu-guardado',
    origin: 'Marta y Jorge, 2026-10-14 (la pregunta es reconstruida; la respuesta, literal)',
    context: [
      'Hoy es miercoles 2026-10-14 (dayIndex 2), son las 20:15 en Madrid.',
      'Hogar: 2 adultos',
      'Menu de esta semana (2026-10-12):',
      '  Jue (dayIndex 3): comida [solo hoy: 4]: Lentejas estofadas; cena: Tortilla de patatas',
    ].join('\n'),
    history: [
      { role: 'user', content: 'el jueves a comer vienen mis padres, somos 4' },
      {
        role: 'assistant',
        content: '⟦hecho: set_meal_servings {"day":"jueves","meal":"lunch","servings":4} → Hecho: el jueves 15, comida queda para 4 personas.⟧Hecho:\n- Jueves 15, comida: Lentejas estofadas, para 4',
      },
    ],
    message: 'perfecto. entonces las lentejas del jueves ya están para 4, no?',
    reconstructed: true,
    expect: /\b(4|cuatro)\b/,
    badReply: 'Antes te dije que lo había ajustado, pero este turno no veo que lo guardara. Acabo de aplicarlo: el jueves 15 la comida queda para 4.',
  },
  {
    id: 'semana-que-viene-domingo',
    check: 'menu-guardado',
    origin: 'Dani y Sara, 2026-10-17 (la pregunta es reconstruida; la respuesta, literal)',
    context: [
      'Hoy es domingo 2026-10-18 (dayIndex 6), son las 18:30 en Madrid.',
      'Hogar: 2 adultos',
      'Menu de esta semana (2026-10-12):',
      '  Lun (dayIndex 0): comida: Arroz al caldero; cena: Crema de calabacin',
      '  Dom (dayIndex 6): comida: Paella de verduras',
    ].join('\n'),
    history: [],
    message: '¿nos has dejado los táperes de lentejas de lunes a jueves para llevar al trabajo?',
    reconstructed: true,
    toolResults: {
      get_weekly_menu:
        'Menu de la semana del lunes 19 de octubre:\nlunes 19 de octubre: comida: Lentejas estofadas, cena: Tortilla de patatas\nmartes 20 de octubre: comida: Lentejas estofadas (sobras)\nmiércoles 21 de octubre: comida: Lentejas estofadas (sobras)\njueves 22 de octubre: comida: Lentejas estofadas (sobras)',
      get_todays_menu: 'Menu del lunes 19 de octubre: comida: Lentejas estofadas, cena: Tortilla de patatas',
    },
    expect: /lentejas/,
    forbidden: [/no hay taper/, /arroz al caldero/],
    mustCallOneOf: ['get_weekly_menu', 'get_todays_menu'],
    badReply: 'No hay táperes de lentejas ni de ternera de lunes a jueves: el lunes tenéis arroz al caldero. No te fíes de lo que te dije antes.',
  },
]
