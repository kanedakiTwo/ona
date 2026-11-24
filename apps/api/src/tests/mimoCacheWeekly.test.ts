/**
 * PRO-1291: `/admin/usage` gives, per week, the cache tokens Mimo writes and
 * reads per turn on WhatsApp and in the app's chat, and the mean write of the
 * turns that come less than 5 minutes after the previous one. PRO-392 made
 * those turns write ~44 000 tokens instead of ~3 000 on 2026-11-11 and it
 * went unseen for 12 days.
 */
import { describe, expect, it } from 'vitest'
import { FOLLOW_UP_MS, buildMimoCacheWeekly, type TurnRow } from '../services/mimoTurnCost.js'

const turn = (feature: string, userId: string | null, at: string, write: number, read: number): TurnRow => ({
  feature,
  userId,
  units: { cacheWriteTokens: write, cacheReadTokens: read },
  costMicros: 0,
  createdAt: new Date(at),
})

describe('buildMimoCacheWeekly', () => {
  it('averages written and read cache tokens per turn, by Madrid week and channel', () => {
    const weeks = buildMimoCacheWeekly([
      turn('whatsapp_chat', 'u1', '2026-11-16T10:00:00Z', 47_000, 0),
      turn('whatsapp_chat', 'u1', '2026-11-16T10:03:00Z', 3_000, 50_000),
      turn('assistant_chat', 'u2', '2026-11-17T09:00:00Z', 40_000, 1_000),
      // Sunday 23:30 UTC is already Monday in Madrid: the next week.
      turn('whatsapp_chat', 'u1', '2026-11-22T23:30:00Z', 5_000, 45_000),
      // Not watched: Telegram and anything that isn't Mimo's chat.
      turn('telegram_chat', 'u3', '2026-11-16T10:00:00Z', 47_000, 0),
      turn('recipe_import', 'u3', '2026-11-16T10:00:00Z', 9_000, 0),
    ])
    expect(weeks).toEqual([
      { week: '2026-11-16', feature: 'assistant_chat', turns: 1, cacheWritePerTurn: 40_000, cacheReadPerTurn: 1_000, followUpTurns: 0, followUpCacheWritePerTurn: null },
      { week: '2026-11-16', feature: 'whatsapp_chat', turns: 2, cacheWritePerTurn: 25_000, cacheReadPerTurn: 25_000, followUpTurns: 1, followUpCacheWritePerTurn: 3_000 },
      { week: '2026-11-23', feature: 'whatsapp_chat', turns: 1, cacheWritePerTurn: 5_000, cacheReadPerTurn: 45_000, followUpTurns: 0, followUpCacheWritePerTurn: null },
    ])
  })

  it('counts as «seguido» only a turn under 5 minutes after the same person’s previous one on the same channel', () => {
    const t0 = Date.parse('2026-11-18T18:00:00Z')
    const at = (ms: number) => new Date(t0 + ms).toISOString()
    const [w] = buildMimoCacheWeekly([
      turn('whatsapp_chat', 'u1', at(0), 47_000, 0),
      turn('whatsapp_chat', 'u2', at(60_000), 44_000, 3_000), // someone else: not a follow-up
      turn('whatsapp_chat', 'u1', at(FOLLOW_UP_MS - 1), 2_000, 47_000), // follow-up
      turn('whatsapp_chat', 'u1', at(2 * FOLLOW_UP_MS), 47_000, 0), // exactly 5 minutes later: not one
      turn('whatsapp_chat', null, at(2 * FOLLOW_UP_MS + 1_000), 1_000, 0), // no person: never one
    ])
    expect(w).toMatchObject({ turns: 5, followUpTurns: 1, followUpCacheWritePerTurn: 2_000 })
  })

  it('returns nothing without turns', () => {
    expect(buildMimoCacheWeekly([])).toEqual([])
  })
})
