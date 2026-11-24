/**
 * PRO-1300: the WhatsApp sign-up in the language of whoever writes. A
 * household wrote its first message in English and got the sign-up and the
 * first menu in Spanish. Now the first contact, the first steps, the first
 * menu's caption and picture, the follow-ups and the ending go out in the
 * language of the first message (language.ts), and that language is saved
 * on the link (`whatsapp_links.language`) for the avisos.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The saved language and the number's messages, in memory (outbound.ts reads them through the store).
const mem = vi.hoisted(() => ({ inbound: [] as string[], saved: null as 'es' | 'en' | null, linked: false }))
vi.mock('../services/whatsapp/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/whatsapp/store.js')>()),
  recentInboundTexts: async () => [...mem.inbound].reverse(),
  linkLanguage: async () => mem.saved,
  setLinkLanguage: async (_phone: string, lang: 'es' | 'en') => {
    if (mem.linked) mem.saved = lang
  },
}))

import { COPY, COPY_EN, processInbound, WHATSAPP_ONBOARDING_QUESTIONS_EN, type InboundDeps } from '../services/whatsapp/inbound.js'
import { languageForPhone, rememberLanguage } from '../services/whatsapp/outbound.js'
import { clearLanguage, detectLanguage } from '../services/whatsapp/language.js'
import { signupFollowUpMessage } from '../services/whatsapp/signupFollowUps.js'
import { weekMenuCaption, weekMenuDigest } from '../services/menuText.js'
import { buildWeekImageModel } from '../services/weekImage/model.js'
import { signupCaption } from '../services/whatsapp/signupReply.js'
import { EMPTY_USAGE } from '../services/advisorBudget.js'
import { AI_DISCLOSURE_FIRST_PERSON_EN } from '@ona/shared'
import type { InboundMessage } from '../services/whatsapp/webhookParser.js'
import type { LinkWithUser } from '../services/whatsapp/store.js'
import type { OutboundMessage } from '../services/whatsapp/render.js'

const NOW = new Date('2026-11-24T12:00:00Z')
const PHONE = '34600111222'
const WEB = 'https://ona.test'

const LINK: LinkWithUser = {
  userId: 'user-1',
  phone: PHONE,
  notify: false,
  lastInboundAt: null,
  email: 'ana@example.com',
  username: 'ana',
  suspendedAt: null,
  onboardingDone: false,
}

function msg(text: string, partial: Partial<InboundMessage> = {}): InboundMessage {
  return {
    wamid: `wamid.${mem.inbound.length}`,
    from: PHONE,
    timestamp: Math.floor(NOW.getTime() / 1000) - 5,
    profileName: 'Ana',
    kind: 'text',
    text,
    mediaId: null,
    mimeType: null,
    replyId: null,
    rawType: 'text',
    ...partial,
  }
}

/** One household going through the sign-up: the link appears once the code is sent. */
function household() {
  const sent: OutboundMessage[] = []
  const kinds = new Map<string, Date>()
  let link: LinkWithUser | null = null
  const chat = vi.fn(async (_u: string, _text: string, _h: unknown, _o: unknown) => ({
    message: 'Your first menu has your *Lasagne* on Thursday. What do you usually have for dinner on a normal Tuesday?',
    toolsUsed: ['complete_onboarding'],
    data: { menuId: 'm-1' },
    usage: EMPTY_USAGE,
  }))
  const menuImage = vi.fn<NonNullable<InboundDeps['menuImage']>>(async (_u, _m, view, lang) => ({
    jpeg: Buffer.from('jpg'),
    caption: weekMenuCaption(WEEK, { today: '2026-11-24', webUrl: WEB, view, generatedWeeks: 1, lang }),
  }))
  const deps: InboundDeps = {
    webUrl: WEB,
    now: () => NOW,
    isUserAllowed: () => true,
    store: {
      getLinkByPhone: async () => link,
      consumeLinkCode: async (code) => {
        if (code !== 'QUPTV7') return null
        link = LINK
        mem.linked = true
        return { userId: 'user-1', onboardingDone: false }
      },
      touchInbound: async () => {},
      updateInbound: async () => {},
      insertOutbound: async (row) => {
        kinds.set(row.kind, NOW)
      },
      loadHistoryRows: async () => [],
      hasRecentOutbound: async () => false,
      recentOutboundKinds: async () => kinds,
      setNotify: async () => true,
    },
    client: {
      sendMessage: async (_to, m) => {
        sent.push(m)
        return `wamid.out.${sent.length}`
      },
      markReadWithTyping: async () => {},
      downloadMedia: async () => ({ buffer: Buffer.from(''), mimeType: 'audio/ogg' }),
    },
    chat: chat as unknown as InboundDeps['chat'],
    checkBudget: async () => ({ exceeded: false, budgetMicros: 5_000_000 }),
    recordUsage: async () => 0,
    menuImage,
    language: languageForPhone,
    rememberLanguage,
  }
  /** The person writes (the webhook stores the message before the turn runs). */
  const write = async (text: string, partial: Partial<InboundMessage> = {}) => {
    mem.inbound.push(text)
    const from = sent.length
    await processInbound(msg(text, partial), deps)
    return sent.slice(from)
  }
  return { write, sent, chat, menuImage, kinds }
}

const WEEK = {
  weekStart: '2026-11-23',
  days: [
    null,
    { dinner: { dishes: [{ kind: 'recipe' as const, recipeId: 'r1', recipeName: 'Crema de calabaza' }] } },
    { dinner: { dishes: [{ kind: 'recipe' as const, recipeId: 'r2', recipeName: 'Lasaña' }] } },
    { lunch: { dishes: [{ kind: 'recipe' as const, recipeId: 'r3', recipeName: 'Lentejas', variant: 'freezer' as const }] } },
    null,
    null,
    null,
  ],
}

const textOf = (m: OutboundMessage) => ('text' in m ? (m.text ?? '') : '')
/** What gives Spanish away in a fixed text (dish names aside). */
const SPANISH = /[¿¡ñáéíóú]|\b(?:el|la|los|las|que|tu|tus|para|con|una|hola|soy|menú|semana|cena|comida)\b/i

beforeEach(() => {
  mem.inbound = []
  mem.saved = null
  mem.linked = false
})

describe('PRO-1300: the sign-up with a first message in English', () => {
  it('every fixed text goes out in English, the language is saved and the avisos read it', async () => {
    const h = household()

    // 1. The first contact: an unlinked number says hi.
    const first = await h.write("Hi! I'd like to try this, how does it work?")
    expect(first.map(textOf)).toEqual([COPY_EN.connect(`${WEB}/whatsapp/conectar`)])
    expect(textOf(first[0])).toContain(AI_DISCLOSURE_FIRST_PERSON_EN)

    // 2. The code from the web (the prefilled message is Spanish-neutral).
    const linked = await h.write('Vincular Mimoia: QUPTV7')
    expect(linked.map(textOf)).toEqual([COPY_EN.linkedOnboarding('Ana')])
    for (const q of WHATSAPP_ONBOARDING_QUESTIONS_EN) expect(textOf(linked[0])).toContain(q)
    expect(textOf(linked[0])).toMatch(/I only need to know four things/)
    expect(mem.saved).toBe('en')

    // 3. The first steps: Mimo is told to answer in English; the first menu's
    // picture and caption are drawn in English.
    const menu = await h.write('2 adults and 1 kid, 6 dinners and 1 lunch. We love lasagne')
    expect(String(h.chat.mock.calls[0][1])).toMatch(/este hogar escribe en inglés/)
    expect(String(h.chat.mock.calls[0][1])).toMatch(/2 adults and 1 kid/)
    expect(h.menuImage).toHaveBeenCalledWith('user-1', 'm-1', 'generated', 'en')
    expect(menu).toHaveLength(1)
    expect(menu[0].type).toBe('image')
    expect(textOf(menu[0])).toContain(`📖 Recipes and shopping list: ona.test/menu`)
    expect(textOf(menu[0])).not.toMatch(/snowball|Change anything|Ready:/)

    // 4. ~10 min later: the health link and the avisos question, with English buttons.
    const lang = await languageForPhone(PHONE)
    expect(lang).toBe('en')
    const health = signupFollowUpMessage('health_link', WEB, lang)
    expect(health.map(textOf)).toEqual([COPY_EN.healthOnWeb(`${WEB}/profile`)])
    const optIn = signupFollowUpMessage('optin_prompt', WEB, lang)
    expect(optIn[0]).toMatchObject({ type: 'buttons', text: COPY_EN.optInPrompt })
    expect((optIn[0] as any).buttons.map((b: any) => b.title)).toEqual(['Yes, notify me', 'No, thanks'])
    h.kinds.set('health_link', NOW).set('optin_prompt', NOW)

    // 5. «Yes, notify me»: the confirmation and the three first steps.
    const end = await h.write('Yes, notify me', { kind: 'interactive', replyId: 'optin_yes' })
    expect(end.map(textOf)).toEqual([COPY_EN.startedFirst, COPY_EN.firstSteps(`${WEB}/menu`)])

    for (const m of [...first, ...linked, ...health, ...optIn, ...end]) expect(textOf(m)).not.toMatch(SPANISH)
    for (const b of (optIn[0] as any).buttons) expect(b.title).not.toMatch(SPANISH)
  })

  it('«No, thanks» to the avisos question is understood and answered in English', async () => {
    const h = household()
    await h.write('Hello, what is this?')
    await h.write('Vincular Mimoia: QUPTV7')
    h.kinds.set('optin_prompt', new Date(NOW.getTime() + 1000))
    const end = await h.write('No, thanks', { kind: 'interactive', replyId: 'optin_no' })
    expect(end.map(textOf)).toEqual([COPY_EN.optInDeclined, COPY_EN.firstSteps(`${WEB}/menu`)])
  })

  it('a lone «Hi» is enough for the first contact', async () => {
    const h = household()
    const first = await h.write('Hi')
    expect(first.map(textOf)).toEqual([COPY_EN.connect(`${WEB}/whatsapp/conectar`)])
  })

  it('the saved language holds when the last messages say nothing (short answers, buttons)', async () => {
    mem.linked = true
    mem.inbound = ['Hi, we are two adults and we cook every day', 'ok']
    expect(await rememberLanguage(PHONE)).toBe('en')
    mem.inbound = ['👍', 'Sí', 'ok']
    expect(await languageForPhone(PHONE)).toBe('en')
    // What the person writes clearly wins over the saved language.
    mem.inbound = ['¿Qué cenamos hoy? Cámbiame el jueves por algo con pollo']
    expect(await languageForPhone(PHONE)).toBe('es')
  })
})

describe('PRO-1300: the sign-up with a first message in Spanish', () => {
  it('every fixed text stays in Spanish and Spanish is saved', async () => {
    const h = household()
    const first = await h.write('Hola, ¿cómo funciona esto?')
    expect(first.map(textOf)).toEqual([COPY.connect(`${WEB}/whatsapp/conectar`)])

    const linked = await h.write('Vincular Mimoia: QUPTV7')
    expect(linked.map(textOf)).toEqual([COPY.linkedOnboarding('Ana')])
    expect(mem.saved).toBe('es')

    await h.write('Somos 2 adultos y un niño, 6 cenas y 1 comida')
    expect(String(h.chat.mock.calls[0][1])).not.toMatch(/escribe en inglés/)
    expect(h.menuImage).toHaveBeenCalledWith('user-1', 'm-1', 'generated', 'es')

    const lang = await languageForPhone(PHONE)
    expect(lang).toBe('es')
    expect(signupFollowUpMessage('health_link', WEB, lang).map(textOf)).toEqual([COPY.healthOnWeb(`${WEB}/profile`)])
    const optIn = signupFollowUpMessage('optin_prompt', WEB, lang)
    expect((optIn[0] as any).buttons.map((b: any) => b.title)).toEqual(['Sí, avísame', 'No, gracias'])
    h.kinds.set('optin_prompt', new Date(NOW.getTime() + 1000))

    const end = await h.write('Sí, avísame', { kind: 'interactive', replyId: 'optin_yes' })
    expect(end.map(textOf)).toEqual([COPY.startedFirst, COPY.firstSteps(`${WEB}/menu`)])
  })

  it('a number whose messages say nothing clear stays in Spanish and saves nothing', async () => {
    mem.linked = true
    mem.inbound = ['Vincular Mimoia: QUPTV7']
    expect(await rememberLanguage(PHONE)).toBe('es')
    expect(mem.saved).toBeNull()
  })
})

describe('PRO-1300: the pieces', () => {
  it('greetings count; anything unclear is null (and Spanish for detectLanguage, as before)', () => {
    expect(clearLanguage(['Hi'])).toBe('en')
    expect(clearLanguage(['Good morning Mimo!'])).toBe('en')
    expect(clearLanguage(['Hola'])).toBe('es')
    expect(clearLanguage(['Buenos días'])).toBe('es')
    expect(clearLanguage(['ok', '👍'])).toBeNull()
    expect(detectLanguage(['ok', '👍'])).toBe('es')
    expect(detectLanguage(['Sí, hecho', 'ok'])).toBe('es')
  })

  it('the first menu in English: caption, digest and picture (dish names as they are)', () => {
    const opts = { today: '2026-11-24', webUrl: WEB, view: 'generated' as const, generatedWeeks: 1, lang: 'en' as const }
    const caption = weekMenuCaption(WEEK, opts)
    expect(caption).toMatch(/^For the first few weeks I'll get your household's tastes less right/)
    expect(caption).toContain('Ready: your menu until Sunday 🍽️')
    expect(caption).toContain('Change anything? Tell me, e.g. "on Thursday, fish".')
    // The sign-up drops the snowball and the invite, as in Spanish.
    expect(signupCaption(caption, false)).toBe('Ready: your menu until Sunday 🍽️\n📖 Recipes and shopping list: ona.test/menu')
    const digest = weekMenuDigest(WEEK, opts)
    expect(digest).toContain('*Tuesday 24 · today*\n🌙 Crema de calabaza')
    expect(digest).toContain('*Wednesday 25 · tomorrow*\n🌙 Lasaña')
    const model = buildWeekImageModel(WEEK, { today: '2026-11-24', lang: 'en' })!
    expect(model.lang).toBe('en')
    expect(model.subtitle).toBe('23 to 29 November · lunch and dinner')
    expect(model.columns.map((c) => c.label)).toEqual(['Lunch', 'Dinner'])
    expect(model.rows.map((r) => r.dayShort)).toEqual(['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(model.rows[0].dateLabel).toBe('24 Nov')
    expect(model.rows[2].cells[0].dishes[0].name).toBe('Lentejas (from the freezer)')
    // Spanish stays the default.
    expect(buildWeekImageModel(WEEK, { today: '2026-11-24' })!.subtitle).toBe('Del 23 al 29 de noviembre · comida y cena')
  })
})
