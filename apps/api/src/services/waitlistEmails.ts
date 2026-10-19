import { ASSISTANT_NAME, BRAND_NAME } from '@ona/shared'
import { listUnsubscribeHeaders, renderBrandEmail, type EmailMessage } from './email.js'
import { MIGUEL } from './emailBrand.js'

/**
 * The emails the waitlist sends (specs/email.md, specs/waitlist.md), in the
 * brand shell the newsletter shares (emailBrand.ts). Written and signed by
 * Miguel (constitution §5); no health claims, no fake scarcity.
 */

export interface InviteEmailInput {
  email: string
  firstName: string | null
  wantsWhatsapp: boolean | null
  /** The personal, one-time link `<WEB_PUBLIC_URL>/entrar/<token>` (PRO-97). */
  entryUrl: string
  unsubscribeUrl: string
}

/**
 * PRO-190 (MKT-25, Legal 2026-10-17): for whoever asked for WhatsApp, right
 * under the button.
 */
function whatsappLine(i: Pick<InviteEmailInput, 'wantsWhatsapp'>): string[] {
  return i.wantsWhatsapp
    ? [
        `Nos dijiste que te interesa WhatsApp: cuando tengas la cuenta, ve a tu perfil, pulsa «Conectar WhatsApp» y pídele a ${ASSISTANT_NAME} el menú como a cualquier contacto.`,
      ]
    : []
}

const LINK_NOTE = 'El enlace es solo para ti y sirve una vez: con él creas la cuenta con este mismo correo.'

/** PRO-190: a reply reaches Miguel (Legal: «me llega a mí», not «lo leo yo»). */
export const INVITE_REPLY_LINE = 'Si tienes cualquier duda, responde a este correo: me llega a mí.'

/** PRO-190: the reminder's honest line about time, no pressure (Legal: «sigue funcionando», not «no caduca»). */
export const INVITE_LINK_STILL_WORKS = 'El enlace sigue funcionando: úsalo cuando te venga bien.'

/** PRO-190: the invitation and its reminder come from a person, on the same inbox. */
export const INVITE_SENDER_NAME = `Miguel de ${BRAND_NAME}`

const SENDER = { fromName: INVITE_SENDER_NAME, replyToSender: true } as const

function hello(name: string | null): string {
  const n = name?.trim()
  return n ? `Hola, ${n}:` : 'Hola:'
}

/** The invitation `POST /admin/waitlist/invite` sends to each person of the batch. Signed by Miguel. */
export function waitlistInviteEmail(i: InviteEmailInput): EmailMessage {
  const name = i.firstName?.trim()
  const subject = `¡Te toca${name ? `, ${name}` : ''}! Ya puedes entrar en ${BRAND_NAME}`
  const { html, text } = renderBrandEmail({
    preheader: `Tu invitación a ${BRAND_NAME} está lista.`,
    eyebrow: 'Lista de espera',
    heading: 'Ya puedes *entrar*',
    paragraphs: [
      hello(i.firstName),
      `Te apuntaste a la lista de espera de ${BRAND_NAME} y ahora te toca a ti. Entramos por tandas pequeñas porque quiero acompañar de cerca a cada casa.`,
      'Creas la cuenta, contestas cinco preguntas sobre tu casa y en unos 2 minutos tienes tu primer menú de la semana con su lista de la compra.',
    ],
    button: { label: 'Crear mi cuenta', url: i.entryUrl },
    after: [...whatsappLine(i), LINK_NOTE, INVITE_REPLY_LINE],
    signoff: 'Un abrazo,',
    from: MIGUEL,
    footer: [
      `Te escribo porque te apuntaste a la lista de espera de ${BRAND_NAME}.`,
      'Si ya no te interesa, puedes darte de baja y borramos tu correo.',
    ],
    unsubscribeUrl: i.unsubscribeUrl,
  })
  return { to: i.email, subject, html, text, headers: listUnsubscribeHeaders(i.unsubscribeUrl), ...SENDER }
}

/** The single reminder, 3 days later, if they haven't created the account (same link). Signed by Miguel. */
export function waitlistInviteReminderEmail(i: InviteEmailInput): EmailMessage {
  const name = i.firstName?.trim()
  const subject = `${name ? `${name}, tu` : 'Tu'} invitación a ${BRAND_NAME} sigue aquí`
  const { html, text } = renderBrandEmail({
    preheader: 'Tu enlace para entrar sigue funcionando.',
    eyebrow: 'Lista de espera',
    heading: 'Tu invitación sigue *aquí*',
    paragraphs: [
      hello(i.firstName),
      `Hace unos días te avisé de que ya podías entrar en ${BRAND_NAME} y aún no has creado la cuenta. Sin prisa: te dejo otra vez el enlace.`,
      'En unos 2 minutos tienes tu primer menú de la semana con su lista de la compra.',
    ],
    button: { label: 'Crear mi cuenta', url: i.entryUrl },
    after: [...whatsappLine(i), LINK_NOTE, INVITE_LINK_STILL_WORKS, 'Es el único recordatorio que te mando.', INVITE_REPLY_LINE],
    signoff: 'Un abrazo,',
    from: MIGUEL,
    footer: [`Te escribo porque te apuntaste a la lista de espera de ${BRAND_NAME}.`],
    unsubscribeUrl: i.unsubscribeUrl,
  })
  return { to: i.email, subject, html, text, headers: listUnsubscribeHeaders(i.unsubscribeUrl), ...SENDER }
}
