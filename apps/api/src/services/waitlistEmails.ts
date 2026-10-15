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

function whatsappLine(i: Pick<InviteEmailInput, 'wantsWhatsapp'>): string[] {
  return i.wantsWhatsapp
    ? [
        `Nos dijiste que te interesa WhatsApp: cuando tengas la cuenta, ve a tu perfil, pulsa «Conectar WhatsApp» y pídeselo todo a ${ASSISTANT_NAME}, nuestra asistente, como a cualquier contacto.`,
      ]
    : []
}

const LINK_NOTE = 'El enlace es solo para ti y sirve una vez: con él creas la cuenta con este mismo correo.'

function hello(name: string | null): string {
  const n = name?.trim()
  return n ? `Hola, ${n}:` : 'Hola:'
}

/** The invitation `POST /admin/waitlist/invite` sends to each person of the batch. Signed by Miguel. */
export function waitlistInviteEmail(i: InviteEmailInput): EmailMessage {
  const name = i.firstName?.trim()
  const subject = `¡Te toca${name ? `, ${name}` : ''}! Ya puedes entrar en ${BRAND_NAME}`
  const { html, text } = renderBrandEmail({
    preheader: `Tu plaza en ${BRAND_NAME} está lista.`,
    eyebrow: 'Lista de espera',
    heading: 'Ya puedes *entrar*',
    paragraphs: [
      hello(i.firstName),
      `Te apuntaste a la lista de espera de ${BRAND_NAME} y ahora te toca a ti. Entramos por tandas pequeñas porque quiero acompañar de cerca a cada casa.`,
      'Creas la cuenta, contestas cinco preguntas sobre tu casa y en unos 2 minutos tienes tu primer menú de la semana con su lista de la compra.',
      ...whatsappLine(i),
    ],
    button: { label: 'Crear mi cuenta', url: i.entryUrl },
    after: [LINK_NOTE],
    signoff: 'Un abrazo,',
    from: MIGUEL,
    footer: [
      `Te escribo porque te apuntaste a la lista de espera de ${BRAND_NAME}.`,
      'Si ya no te interesa, puedes darte de baja y borramos tu correo.',
    ],
    unsubscribeUrl: i.unsubscribeUrl,
  })
  return { to: i.email, subject, html, text, headers: listUnsubscribeHeaders(i.unsubscribeUrl) }
}

/** The single reminder, 3 days later, if they haven't created the account (same link). Signed by Miguel. */
export function waitlistInviteReminderEmail(i: InviteEmailInput): EmailMessage {
  const name = i.firstName?.trim()
  const subject = `${name ? `${name}, tu` : 'Tu'} invitación a ${BRAND_NAME} sigue aquí`
  const { html, text } = renderBrandEmail({
    preheader: 'Tu enlace para entrar sigue funcionando.',
    eyebrow: 'Lista de espera',
    heading: 'Tu plaza sigue *aquí*',
    paragraphs: [
      hello(i.firstName),
      `Hace unos días te avisé de que ya podías entrar en ${BRAND_NAME} y aún no has creado la cuenta. Sin prisa: te dejo otra vez el enlace.`,
      'En unos 2 minutos tienes tu primer menú de la semana con su lista de la compra.',
      ...whatsappLine(i),
    ],
    button: { label: 'Crear mi cuenta', url: i.entryUrl },
    after: [LINK_NOTE, 'Es el único recordatorio que te mando.'],
    signoff: 'Un abrazo,',
    from: MIGUEL,
    footer: [`Te escribo porque te apuntaste a la lista de espera de ${BRAND_NAME}.`],
    unsubscribeUrl: i.unsubscribeUrl,
  })
  return { to: i.email, subject, html, text, headers: listUnsubscribeHeaders(i.unsubscribeUrl) }
}
