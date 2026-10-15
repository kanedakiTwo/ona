import { ASSISTANT_NAME, BRAND_NAME } from '@ona/shared'
import { listUnsubscribeHeaders, renderBrandEmail, type EmailMessage } from './email.js'

/**
 * The emails the waitlist sends (specs/email.md, specs/waitlist.md), in the
 * brand shell the newsletter shares (cream, Fraunces, terracotta button).
 * Plain words, Mimo's voice, no health claims, no fake scarcity.
 */

export interface InviteEmailInput {
  email: string
  firstName: string | null
  wantsWhatsapp: boolean | null
  /** The personal, one-time link `<WEB_PUBLIC_URL>/entrar/<token>` (PRO-97). */
  entryUrl: string
  unsubscribeUrl: string
}

function whatsappLine(i: Pick<InviteEmailInput, 'wantsWhatsapp'>): string[] {
  return i.wantsWhatsapp
    ? [
        `Nos dijiste que te interesa WhatsApp: cuando tengas la cuenta, ve a tu perfil, pulsa «Conectar WhatsApp» y escríbeme por ahí como a cualquier contacto. Soy ${ASSISTANT_NAME}.`,
      ]
    : []
}

const LINK_NOTE = 'El enlace es solo para ti y sirve una vez: con él creas la cuenta con este mismo correo.'

/** The invitation `POST /admin/waitlist/invite` sends to each person of the batch. */
export function waitlistInviteEmail(i: InviteEmailInput): EmailMessage {
  const name = i.firstName?.trim()
  const subject = `¡Te toca${name ? `, ${name}` : ''}! Ya puedes entrar en ${BRAND_NAME}`
  const paragraphs = [
    `${name ? `Hola, ${name}. ` : 'Hola. '}Soy ${ASSISTANT_NAME}, de ${BRAND_NAME}. Entramos por tandas para acompañar de cerca a cada hogar, y ahora es la tuya.`,
    `Qué esperar: creas la cuenta, contestas cinco preguntas sobre tu casa y en unos 2 minutos tienes tu primer menú de la semana con su lista de la compra.`,
    ...whatsappLine(i),
    LINK_NOTE,
  ]
  const { html, text } = renderBrandEmail({
    preheader: `Tu plaza en ${BRAND_NAME} está lista.`,
    heading: `Ya puedes entrar en ${BRAND_NAME}`,
    paragraphs,
    button: { label: 'Crear mi cuenta', url: i.entryUrl },
    footer: [
      `Te escribimos porque te apuntaste a la lista de espera de ${BRAND_NAME}.`,
      'Si ya no te interesa, puedes darte de baja y borramos tu correo.',
    ],
    unsubscribeUrl: i.unsubscribeUrl,
  })
  return { to: i.email, subject, html, text, headers: listUnsubscribeHeaders(i.unsubscribeUrl) }
}

/** The single reminder, 3 days later, if they haven't created the account (same link). */
export function waitlistInviteReminderEmail(i: InviteEmailInput): EmailMessage {
  const name = i.firstName?.trim()
  const subject = `${name ? `${name}, tu` : 'Tu'} invitación a ${BRAND_NAME} sigue aquí`
  const paragraphs = [
    `${name ? `Hola, ${name}. ` : 'Hola. '}Hace unos días te avisé de que ya podías entrar en ${BRAND_NAME} y aún no has creado la cuenta. Sin prisa: te dejo otra vez el enlace.`,
    'En unos 2 minutos tienes tu primer menú de la semana con su lista de la compra.',
    ...whatsappLine(i),
    LINK_NOTE,
    'Es el único recordatorio que te mando.',
  ]
  const { html, text } = renderBrandEmail({
    preheader: 'Tu enlace para entrar sigue funcionando.',
    heading: 'Tu plaza sigue aquí',
    paragraphs,
    button: { label: 'Crear mi cuenta', url: i.entryUrl },
    footer: [`Te escribimos porque te apuntaste a la lista de espera de ${BRAND_NAME}.`],
    unsubscribeUrl: i.unsubscribeUrl,
  })
  return { to: i.email, subject, html, text, headers: listUnsubscribeHeaders(i.unsubscribeUrl) }
}
