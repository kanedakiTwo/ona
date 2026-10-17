/**
 * Replay of the morning brief for the same household on consecutive days
 * (PRO-156 «Hecho cuando»): each day's message is written from its guide with
 * the previous days' messages as context, exactly as the scheduler does, and
 * `repeatedSentences` lists any sentence that came out more than once.
 * Used by `whatsappGuided.test.ts` (simulated writer) and by
 * `scripts/replayGuidedBrief.ts` (the real model).
 */
import type { DayMenu } from '@ona/shared'
import { dailyBriefGuide, formatDailyBrief } from './proactive.js'
import { composeGuided, sentencesOf, type GuidedResult, type GuidedWriter } from './guided.js'

export interface ReplayOptions {
  webUrl: string
  writer: GuidedWriter | null
  memory?: string[]
  /** What the user said on each day, if anything (oldest first), shown as recent conversation the next morning. */
  replies?: Array<string | null>
}

export async function replayDailyBriefs(days: readonly DayMenu[], opts: ReplayOptions): Promise<GuidedResult[]> {
  const sent: string[] = []
  const out: GuidedResult[] = []
  for (let i = 0; i < days.length; i++) {
    const fallback = formatDailyBrief(days[i], opts.webUrl)
    const spec = dailyBriefGuide(days[i], opts.webUrl)
    if (!fallback || !spec) continue
    const said = i > 0 ? opts.replies?.[i - 1] : null
    const r = await composeGuided(spec, fallback, {
      writer: opts.writer,
      userId: null,
      overBudget: async () => false,
      context: async () => ({
        memory: opts.memory ?? [],
        recent: said ? [{ who: 'mimo', text: sent[0] ?? '' }, { who: 'usuario', text: said }] : [],
        previous: [...sent],
      }),
    })
    out.push(r)
    sent.unshift(r.text)
  }
  return out
}

/** Pure: sentences (4+ words, links left out) that appear in more than one message. */
export function repeatedSentences(texts: readonly string[]): string[] {
  const seen = new Map<string, number>()
  for (const t of texts) for (const s of new Set(sentencesOf(t))) seen.set(s, (seen.get(s) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([s]) => s)
}
