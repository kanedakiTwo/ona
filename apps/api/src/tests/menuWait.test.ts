/**
 * PRO-1298: the menu's wait in GET /admin/usage → `menuWait` (specs/metrics.md):
 * generate_weekly_menu and the sign-up's last step, p50 and p95 by week. The
 * engine times each tool (`toolTrace[].ms`) and WhatsApp hands Mimo when the
 * message was sent and, for a button, what it answered.
 */
import { describe, it, expect, vi } from 'vitest'
import { buildMenuWait, waitStats, MENU_WAIT_DEFINITION, type MenuTurnRow } from '../services/menuWaitReport.js'
import { runToolLoop } from '../services/assistant/engine.js'
import { processInbound, sentAt, type InboundDeps } from '../services/whatsapp/inbound.js'
import type { InboundMessage } from '../services/whatsapp/webhookParser.js'
import type { SkillDefinition } from '../services/assistant/types.js'
import { EMPTY_USAGE } from '../services/advisorBudget.js'

const WEEKS = ['2026-11-16', '2026-11-23']
const gen = (ms: number, extra: Record<string, unknown> = {}) => ({ name: 'generate_weekly_menu', ms, ...extra })

describe('menuWait (PRO-1298)', () => {
  it('waitStats: nearest-rank p50 and p95 in seconds, and how many passed the minute', () => {
    const s = waitStats([10_000, 20_000, 30_000, 40_000, 132_000])
    expect(s).toEqual({ n: 5, p50S: 30, p95S: 132, over60: 1 })
    expect(waitStats([])).toEqual({ n: 0, p50S: null, p95S: null, over60: 0 })
    expect(waitStats([45_678]).p50S).toBe(45.7)
  })

  it('by week: the tool, the whole turn, and the sign-up\'s last step; runs that made no menu don\'t count', () => {
    const rows: MenuTurnRow[] = [
      // Last week: an old row without the trace still counts as a turn.
      { day: '2026-11-17', ms: 848_000, tools: ['complete_onboarding'], trace: null },
      { day: '2026-11-19', ms: 132_000, tools: ['generate_weekly_menu'], trace: null },
      // This week.
      { day: '2026-11-23', ms: 20_000, tools: ['generate_weekly_menu'], trace: [gen(3_000)] },
      { day: '2026-11-24', ms: 70_000, tools: ['generate_weekly_menu', 'swap_meal'], trace: [gen(5_000), { name: 'swap_meal', ms: 40_000 }] },
      // «La semana ya tiene menú» and a failure: neither the tool nor the turn.
      { day: '2026-11-24', ms: 6_000, tools: ['generate_weekly_menu'], trace: [gen(200, { unchanged: true })] },
      { day: '2026-11-24', ms: 9_000, tools: ['generate_weekly_menu'], trace: [gen(300, { error: true })] },
      { day: '2026-11-25', ms: 50_000, tools: ['complete_onboarding', 'swap_meal'], trace: [{ name: 'complete_onboarding', ms: 4_000 }, { name: 'swap_meal', ms: 30_000 }] },
      // Out of the window.
      { day: '2026-11-02', ms: 1_000, tools: ['generate_weekly_menu'], trace: [gen(1_000)] },
    ]
    const [last, current] = buildMenuWait(WEEKS, rows)
    expect(last).toMatchObject({
      week: '2026-11-16',
      isoWeek: '2026-W47',
      generate: { n: 0, p50S: null },
      generateTurn: { n: 1, p50S: 132, p95S: 132, over60: 1 },
      signup: { n: 0 },
      signupTurn: { n: 1, p95S: 848, over60: 1 },
    })
    expect(current).toMatchObject({
      week: '2026-11-23',
      generate: { n: 2, p50S: 3, p95S: 5, over60: 0 },
      generateTurn: { n: 2, p50S: 20, p95S: 70, over60: 1 },
      signup: { n: 1, p50S: 4 },
      signupTurn: { n: 1, p50S: 50, over60: 0 },
    })
    expect(MENU_WAIT_DEFINITION).toMatch(/p50S \/ p95S/)
  })

  it('the engine keeps how long each tool took in the trace', async () => {
    const slow: SkillDefinition = {
      name: 'generate_weekly_menu',
      description: '',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        await new Promise((r) => setTimeout(r, 30))
        return { data: { id: 'm' }, summary: 'Menu generado', uiHint: 'menu' }
      },
    }
    const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    const responses: any[] = [
      { content: [{ type: 'tool_use', id: 't1', name: 'generate_weekly_menu', input: {} }], usage, stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Te he preparado el menú.' }], usage, stop_reason: 'end_turn' },
    ]
    const client = { messages: { create: vi.fn(async () => responses.shift()) } }
    const r = await runToolLoop({ client: client as any, system: 's', tools: [], messages: [{ role: 'user', content: 'hazme el menú' }], skills: [slow], ctx: { userId: 'u', db: null } })
    expect(r.toolTrace?.[0].name).toBe('generate_weekly_menu')
    expect(r.toolTrace?.[0].ms).toBeGreaterThanOrEqual(25)
  })
})

describe('WhatsApp hands Mimo the message\'s time and the button (PRO-1298)', () => {
  const NOW = new Date('2026-11-23T19:10:00Z')
  const msg = (partial: Partial<InboundMessage>): InboundMessage => ({
    wamid: 'w1', from: '34600000073', timestamp: Math.floor(NOW.getTime() / 1000) - 300, profileName: null,
    kind: 'text', text: 'hazme el menú', mediaId: null, mimeType: null, replyId: null, rawType: 'text', ...partial,
  })
  function deps(history: { direction: 'in' | 'out'; body: string }[] = []) {
    const chat = vi.fn(async () => ({ message: 'Vale.', usage: EMPTY_USAGE }))
    const d = {
      webUrl: 'https://mimoia.test',
      now: () => NOW,
      isUserAllowed: () => true,
      store: {
        getLinkByPhone: async () => ({ userId: 'u1', phone: '34600000073', notify: true, lastInboundAt: null, email: null, username: 'u', suspendedAt: null, onboardingDone: true }),
        consumeLinkCode: async () => null,
        touchInbound: async () => {},
        updateInbound: async () => {},
        insertOutbound: async () => {},
        loadHistoryRows: async () => history.map((h, i) => ({ ...h, kind: h.direction === 'in' ? 'text' : 'reply', status: h.direction === 'in' ? 'processed' : 'sent', createdAt: new Date(NOW.getTime() - (history.length - i) * 60_000), meta: null })),
        hasRecentOutbound: async () => false,
        recentOutboundKinds: async () => new Map(),
        setNotify: async () => true,
      },
      client: { sendMessage: async () => 'wamid.out', markReadWithTyping: async () => {}, downloadMedia: async () => ({ buffer: Buffer.from(''), mimeType: 'x' }) },
      chat,
      checkBudget: async () => ({ exceeded: false, budgetMicros: 5_000_000 }),
      recordUsage: async () => 0,
    } as unknown as InboundDeps
    return { d, chat }
  }

  it('sentAt: Meta\'s seconds, or now when missing or ahead of the clock', () => {
    expect(sentAt({ timestamp: 1_700_000_000 }, NOW).getTime()).toBe(1_700_000_000_000)
    expect(sentAt({ timestamp: 0 }, NOW)).toBe(NOW)
    expect(sentAt({ timestamp: NOW.getTime() / 1000 + 60 }, NOW)).toBe(NOW)
  })

  it('a text: requestedAt is when it was sent (it may have waited behind a slow turn), no button', async () => {
    const { d, chat } = deps()
    await processInbound(msg({}), d)
    const opts = (chat.mock.calls[0] as any[])[3]
    expect(opts.requestedAt).toEqual(new Date(NOW.getTime() - 300_000))
    expect(opts.button).toBeUndefined()
  })

  it('a tapped button: its title and the question it answered', async () => {
    const { d, chat } = deps([
      { direction: 'in', body: 'hola' },
      { direction: 'out', body: 'Tu cena de hoy: *Lentejas*.\n¿La hiciste?\n⟦botones: Sí | No, cenamos otra cosa⟧' },
    ])
    await processInbound(msg({ kind: 'interactive', text: 'No, cenamos otra cosa', replyId: 'opt:1', rawType: 'interactive' }), d)
    const opts = (chat.mock.calls[0] as any[])[3]
    expect(opts.button.title).toBe('No, cenamos otra cosa')
    expect(opts.button.asked).toContain('¿La hiciste?')
  })
})
