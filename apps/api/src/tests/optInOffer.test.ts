/**
 * PRO-248: the one extra offer of the avisos in the web chat — one line after
 * Mimo's reply, the same thing WhatsApp asks with its buttons (D-051).
 * The SQL side (who is due, «dijo que no») is in optInOffer.smoke.ts.
 */
import { describe, expect, it } from 'vitest'
import { REOFFER_AFTER_DAYS, REOFFER_WEB, withReofferLine } from '../services/whatsapp/optInOffer.js'
import { COPY } from '../services/whatsapp/inbound.js'

describe('the extra avisos offer in the web chat (PRO-248)', () => {
  it('goes as the last line of the reply, once', () => {
    const out = withReofferLine('Hoy toca lentejas.  ')
    expect(out).toBe(`Hoy toca lentejas.\n\n${REOFFER_WEB}`)
    expect(REOFFER_WEB.split('\n')).toHaveLength(1)
    expect(withReofferLine('')).toBe(REOFFER_WEB)
  })

  it('offers the same avisos as WhatsApp and says it is the only time', () => {
    for (const text of [REOFFER_WEB, COPY.optInReoffer]) {
      expect(text).toMatch(/menú del día/)
      expect(text).toMatch(/lista de la compra los sábados/)
      expect(text).toMatch(/[Ss]olo te lo pregunto esta vez/)
    }
    // The web line tells how to say yes (Mimo then calls set_whatsapp_notifications).
    expect(REOFFER_WEB).toMatch(/«sí, avísame»/)
    expect(REOFFER_AFTER_DAYS).toBe(7)
  })
})
