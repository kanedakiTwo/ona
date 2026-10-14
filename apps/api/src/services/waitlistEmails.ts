import { ASSISTANT_NAME, BRAND_NAME } from '@ona/shared'
import { listUnsubscribeHeaders, renderBrandEmail, type EmailMessage } from './email.js'

/**
 * The emails the waitlist sends (specs/email.md, specs/waitlist.md).
 * Plain words, no health claims, no fake scarcity.
 */

export interface InviteEmailInput {
  email: string
  firstName: string | null
  wantsWhatsapp: boolean | null
  unsubscribeUrl: string
}

/** The invitation `POST /admin/waitlist/invite` sends to each person of the batch. */
export function waitlistInviteEmail(i: InviteEmailInput, opts: { publicUrl: string }): EmailMessage {
  const base = opts.publicUrl.replace(/\/+$/, '')
  const name = i.firstName?.trim()
  const subject = `¡Te toca${name ? `, ${name}` : ''}! Ya puedes entrar en ${BRAND_NAME}`
  const paragraphs = [
    `${name ? `Hola, ${name}. ` : ''}Ya puedes crear tu cuenta en ${BRAND_NAME}. Entramos por tandas para acompañar de cerca a cada hogar, y ahora es la tuya.`,
    'Regístrate con este mismo email: es el que tenemos en la lista.',
    'En un par de minutos tendrás tu primer menú de la semana y su lista de la compra.',
    ...(i.wantsWhatsapp
      ? [
          `Nos dijiste que te interesa WhatsApp: cuando tengas la cuenta, conéctalo desde tu perfil y podrás hablar con ${ASSISTANT_NAME} por ahí.`,
        ]
      : []),
  ]
  const { html, text } = renderBrandEmail({
    preheader: `Tu plaza en ${BRAND_NAME} está lista.`,
    heading: `Ya puedes entrar en ${BRAND_NAME}`,
    paragraphs,
    button: { label: 'Crear mi cuenta', url: `${base}/register` },
    footer: [`Te escribimos porque te apuntaste a la lista de espera de ${BRAND_NAME}.`],
    unsubscribeUrl: i.unsubscribeUrl,
  })
  return { to: i.email, subject, html, text, headers: listUnsubscribeHeaders(i.unsubscribeUrl) }
}
