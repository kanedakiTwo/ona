import { describe, it, expect } from 'vitest'
import { extractOptions, splitMessage, toWhatsAppMarkup } from '../services/whatsapp/format.js'
import { renderAssistantReply, appLinkFor } from '../services/whatsapp/render.js'
import { buildChatHistory, ONA_STARTED_MARKER, type HistoryRow } from '../services/whatsapp/history.js'
import {
  generateLinkCode,
  extractLinkCodeCandidates,
  buildWaLink,
  linkMessageText,
  maskPhone,
  LINK_CODE_ALPHABET,
} from '../services/whatsapp/linking.js'

const WEB = 'https://ona.test'

describe('toWhatsAppMarkup', () => {
  it('converts markdown bold, headings and links to WhatsApp markup', () => {
    expect(toWhatsAppMarkup('## Lunes\n**Comida**: lentejas\n[Ver](https://x.y/z)')).toBe(
      '*Lunes*\n*Comida*: lentejas\nVer: https://x.y/z',
    )
  })
})

describe('extractOptions', () => {
  it('pulls a trailing options line into buttons', () => {
    expect(extractOptions('¿Genero el menú nuevo?\n[[opciones: Sí | No]]')).toEqual({
      text: '¿Genero el menú nuevo?',
      options: ['Sí', 'No'],
    })
  })
  it('truncates long titles to the 20-char WhatsApp limit', () => {
    const { options } = extractOptions('x [[opciones: Prepárame el menú completo | No]]')
    expect(options[0].length).toBeLessThanOrEqual(20)
  })
  it('folds more than 3 options back into the text', () => {
    const r = extractOptions('¿Qué día?\n[[opciones: Lunes | Martes | Miércoles | Jueves]]')
    expect(r.options).toEqual([])
    expect(r.text).toContain('- Jueves')
  })
  it('leaves text without the marker alone', () => {
    expect(extractOptions('Hola')).toEqual({ text: 'Hola', options: [] })
  })
})

describe('splitMessage', () => {
  it('keeps short text in one chunk and drops empty text', () => {
    expect(splitMessage('hola')).toEqual(['hola'])
    expect(splitMessage('   ')).toEqual([])
  })
  it('splits long text on paragraph boundaries under the max', () => {
    const para = 'a'.repeat(60)
    const chunks = splitMessage([para, para, para].join('\n\n'), 130)
    expect(chunks).toEqual([`${para}\n\n${para}`, para])
    expect(chunks.every((c) => c.length <= 130)).toBe(true)
  })
})

describe('renderAssistantReply', () => {
  it('adds an app deep link by uiHint', () => {
    expect(renderAssistantReply({ message: 'Hoy toca lentejas.', uiHint: 'menu' }, WEB)).toEqual([
      { type: 'text', text: `Hoy toca lentejas.\n\nVer menú: ${WEB}/menu` },
    ])
    expect(appLinkFor({ uiHint: 'recipe', data: { recipeId: 'r1' } }, WEB)).toBe(`Ver receta: ${WEB}/recipes/r1`)
    expect(appLinkFor({ uiHint: 'recipe', data: [{ id: 'r1' }] }, WEB)).toBeNull()
    expect(appLinkFor({ uiHint: 'cooking_navigate', data: { recipeId: 'r1' } }, WEB)).toBe(`Modo cocina: ${WEB}/recipes/r1/cook`)
    expect(appLinkFor({ uiHint: 'text', data: { navigateTo: '/recipes/r1/edit' } }, WEB)).toBe(`Ábrelo en la app: ${WEB}/recipes/r1/edit`)
    expect(appLinkFor({ uiHint: 'shopping_list' }, WEB)).toBe(`Ver lista de la compra: ${WEB}/shopping`)
  })

  it('does not duplicate the deep link when the model already wrote it', () => {
    expect(renderAssistantReply({ message: `Menú listo.\n\nVer menú: ${WEB}/menu`, uiHint: 'menu' }, WEB)).toEqual([
      { type: 'text', text: `Menú listo.\n\nVer menú: ${WEB}/menu` },
    ])
  })

  it('renders options as reply buttons', () => {
    expect(renderAssistantReply({ message: '¿Te lo cambio?\n[[opciones: Sí | No]]' }, WEB)).toEqual([
      { type: 'buttons', text: '¿Te lo cambio?', buttons: [{ id: 'opt:0', title: 'Sí' }, { id: 'opt:1', title: 'No' }] },
    ])
  })

  it('sends long bodies as text and the buttons separately', () => {
    const out = renderAssistantReply({ message: `${'x'.repeat(1100)}\n[[opciones: Sí | No]]` }, WEB)
    expect(out[0].type).toBe('text')
    expect(out[out.length - 1]).toMatchObject({ type: 'buttons', text: 'Elige una opción:' })
  })

  it('never sends an empty message', () => {
    expect(renderAssistantReply({ message: '' }, WEB)).toEqual([{ type: 'text', text: 'Hecho.' }])
  })
})

describe('buildChatHistory', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  const at = (min: number) => new Date(now.getTime() - min * 60_000)
  const row = (direction: 'in' | 'out', body: string, min: number, status?: string): HistoryRow => ({
    direction,
    body,
    createdAt: at(min),
    status: status ?? (direction === 'in' ? 'processed' : 'sent'),
  })

  it('maps in/out to user/assistant in chronological order', () => {
    expect(buildChatHistory([row('out', 'Hola!', 9), row('in', 'hola', 10)], now)).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'Hola!' },
    ])
  })

  it('merges consecutive same-role turns and drops a trailing unanswered user turn', () => {
    const h = buildChatHistory(
      [row('in', 'a', 10), row('in', 'b', 9), row('out', 'c1', 8), row('out', 'c2', 7), row('in', 'd', 6)],
      now,
    )
    expect(h).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c1\n\nc2' },
    ])
  })

  it('prepends a marker when ONA spoke first (proactive nudge)', () => {
    expect(buildChatHistory([row('out', '¿Te preparo el menú?', 5)], now)).toEqual([
      { role: 'user', content: ONA_STARTED_MARKER },
      { role: 'assistant', content: '¿Te preparo el menú?' },
    ])
  })

  it('ignores rows outside the 12 h window, failed rows and empty bodies', () => {
    const h = buildChatHistory(
      [row('in', 'viejo', 13 * 60), row('out', 'viejo', 13 * 60 - 1), row('in', 'fallo', 5, 'failed'), row('in', '', 4), row('in', 'ok', 3), row('out', 'vale', 2)],
      now,
    )
    expect(h).toEqual([
      { role: 'user', content: 'ok' },
      { role: 'assistant', content: 'vale' },
    ])
  })

  it('skips outbound system notices and acks (budget, linking help, "me pongo con ello")', () => {
    const h = buildChatHistory(
      [row('in', 'hola', 5), { ...row('out', 'Has alcanzado tu límite', 4), kind: 'system' }, { ...row('out', 'Un momento…', 4), kind: 'ack' }, { ...row('out', 'Hola!', 3), kind: 'reply' }],
      now,
    )
    expect(h).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'Hola!' },
    ])
  })

  it('caps at the last N messages', () => {
    const rows: HistoryRow[] = []
    for (let i = 0; i < 30; i += 1) rows.push(row(i % 2 === 0 ? 'in' : 'out', `m${i}`, 100 - i))
    const h = buildChatHistory(rows, now, { maxMessages: 4 })
    expect(h.map((m) => m.content)).toEqual(['m26', 'm27', 'm28', 'm29'])
  })
})

describe('linking', () => {
  it('generates 6-char codes from the unambiguous alphabet, always with a digit', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateLinkCode()
      expect(code).toHaveLength(6)
      expect([...code].every((c) => LINK_CODE_ALPHABET.includes(c))).toBe(true)
      expect(code).toMatch(/[2-9]/)
    }
    // Deterministic all-letters draw still gets a digit injected.
    expect(generateLinkCode(() => 0)).toMatch(/[2-9]/)
  })

  it('finds the code in the prefilled message, case-insensitively', () => {
    expect(extractLinkCodeCandidates(linkMessageText('4F7K2A'))).toEqual(['4F7K2A'])
    expect(extractLinkCodeCandidates('mi código es 4f7k2a gracias')).toEqual(['4F7K2A'])
  })

  it('does not treat ordinary words as codes', () => {
    expect(extractLinkCodeCandidates('quiero PLATOS ricos hoy')).toEqual([])
    expect(extractLinkCodeCandidates('')).toEqual([])
    expect(extractLinkCodeCandidates('código 4F7K2I')).toEqual([]) // I is not in the alphabet
  })

  it('builds wa.me links and masks phones', () => {
    expect(buildWaLink('+1 555 0100', 'Vincular ONA: 4F7K2A')).toBe('https://wa.me/15550100?text=Vincular%20ONA%3A%204F7K2A')
    expect(maskPhone('34600111222')).toBe('+34 ••• ••• 222')
  })
})
