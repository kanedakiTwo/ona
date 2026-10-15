import { ASSISTANT_NAME, BRAND_NAME } from '@ona/shared'
import { renderBrandEmail, type EmailMessage } from './email.js'
import { MIGUEL, brandAssets } from './emailBrand.js'

/**
 * The account emails (specs/email.md): the welcome when an account is
 * created and the self-service password reset link. The welcome is written
 * and signed by Miguel (constitution §5); the reset is plain and unsigned.
 */

/**
 * Which welcome: `beta` = came in through the closed beta (waitlist link,
 * a beta invitation link or an admin email); `household` = joining someone
 * else's home with their invitation; `general` = open registration.
 */
export type WelcomeKind = 'beta' | 'household' | 'general'

export function welcomeKind(i: { access: string | null; joiningHousehold: boolean }): WelcomeKind {
  if (i.joiningHousehold) return 'household'
  if (i.access === 'waitlist' || i.access === 'campaign' || i.access === 'admin') return 'beta'
  return 'general'
}

export interface WelcomeEmailInput {
  email: string
  firstName?: string | null
  kind: WelcomeKind
  /** Web origin (`WEB_PUBLIC_URL`). */
  publicUrl: string
}

function hello(name?: string | null): string {
  const n = name?.trim()
  return n ? `Hola, ${n}:` : 'Hola:'
}

const WHATSAPP_STEP = `Conecta WhatsApp desde tu perfil y pídeselo todo a ${ASSISTANT_NAME}, nuestra asistente, como a cualquier contacto.`
const FIRST_STEPS = [
  'Contesta unas preguntas sobre tu casa: quiénes coméis y qué os gusta.',
  'Mira tu primer menú de la semana y cambia lo que no te apetezca.',
  'Abre la lista de la compra: ya sale hecha con lo que te falta.',
  WHATSAPP_STEP,
]
const TELL_ME = 'Si algo falla o echas algo en falta, contesta a este correo y cuéntamelo: lo leo yo.'

export function welcomeEmail(i: WelcomeEmailInput): EmailMessage {
  const web = i.publicUrl.replace(/\/+$/, '')
  const common = {
    button: { label: `Abrir ${BRAND_NAME}`, url: `${web}/menu` },
    from: MIGUEL,
    footer: [`Te escribo porque acabas de crear tu cuenta en ${BRAND_NAME}.`],
    assets: brandAssets(web),
  }
  const byKind = {
    beta: {
      subject: `Ya estás dentro de ${BRAND_NAME}`,
      preheader: 'Eres de los primeros hogares en probarla. Así empiezas.',
      eyebrow: 'Beta privada',
      heading: 'Ya estás *dentro*',
      paragraphs: [
        hello(i.firstName),
        `Gracias por entrar en ${BRAND_NAME}. Eres de los primeros hogares en probarla, y eso para mí vale mucho.`,
        `Estamos en beta. En mi casa lleva cuatro años funcionando, pero contigo empieza a servirle a más gente. ${TELL_ME}`,
        'Para empezar:',
      ],
      steps: FIRST_STEPS,
      signoff: 'Gracias por estar aquí desde el principio.\nUn abrazo,',
    },
    general: {
      subject: `Te doy la bienvenida a ${BRAND_NAME}`,
      preheader: 'Tu menú de la semana y tu lista de la compra, en unos minutos.',
      eyebrow: undefined,
      heading: 'Te doy la *bienvenida*',
      paragraphs: [
        hello(i.firstName),
        `Gracias por crear tu cuenta. ${BRAND_NAME} nació en mi casa con una idea sencilla: que solo quede la parte divertida de cocinar. Decide contigo el menú de la semana, hace la lista de la compra y te escribe por WhatsApp cuando toca.`,
        TELL_ME,
        'Para empezar:',
      ],
      steps: FIRST_STEPS,
      signoff: 'Un abrazo,',
    },
    household: {
      subject: `Ya tienes cuenta en ${BRAND_NAME}`,
      preheader: 'El mismo menú y la misma lista que el resto de tu casa.',
      eyebrow: undefined,
      heading: 'Ya estás en *casa*',
      paragraphs: [
        hello(i.firstName),
        `Alguien de tu casa te ha invitado a ${BRAND_NAME}, así que compartís el mismo menú de la semana, la misma lista de la compra y la misma despensa: lo que cambie uno, lo ve el otro.`,
        'Para empezar:',
      ],
      steps: [
        'Mira el menú de la semana: es el de toda la casa.',
        'Cuando compres algo, márcalo en la lista. Así nadie lo compra dos veces.',
        WHATSAPP_STEP,
      ],
      signoff: `${TELL_ME}\n\nUn abrazo,`,
    },
  }[i.kind]
  const { subject, ...content } = byKind
  const { html, text } = renderBrandEmail({ ...content, ...common })
  return { to: i.email, subject, html, text }
}

/** How long a self-service reset link lasts (the admin link lasts 24 h). */
export const SELF_RESET_TTL_MS = 60 * 60 * 1000

export function passwordResetEmail(i: { email: string; resetUrl: string }): EmailMessage {
  const { html, text } = renderBrandEmail({
    preheader: 'El enlace sirve una vez y caduca en 1 hora.',
    eyebrow: 'Tu cuenta',
    heading: 'Cambia tu *contraseña*',
    paragraphs: [
      'Hola:',
      `Alguien, seguramente tú, ha pedido cambiar la contraseña de tu cuenta de ${BRAND_NAME}. Pulsa el botón y elige una nueva.`,
    ],
    button: { label: 'Elegir contraseña nueva', url: i.resetUrl },
    after: [
      'El enlace sirve una vez y caduca en 1 hora.',
      'Si no lo has pedido tú, no hagas nada: tu contraseña sigue igual.',
    ],
    footer: [`Te escribimos porque se ha pedido cambiar la contraseña de esta cuenta en ${BRAND_NAME}.`],
  })
  return { to: i.email, subject: `Cambia tu contraseña de ${BRAND_NAME}`, html, text }
}
