/**
 * Mimo's fixed texts on Telegram (PRO-313). The first two are Miguel's,
 * approved word for word; the rest are short system notices.
 */
export const TELEGRAM_COPY = {
  /** Right after `/start <code>` links the chat. */
  linked:
    'Hola, soy Mimo, de Mimoia. Soy una inteligencia artificial y te ayudo con el menú de la semana, la lista de la compra y lo que tengas en la despensa.\n' +
    'Ya estamos conectados con tu cuenta. Pídeme lo que quieras, por ejemplo: «hazme el menú de la semana» o «¿qué ceno hoy con lo que tengo?».\n' +
    'Los avisos (menú de hoy, compra, descongelar) te llegan por aquí si los tienes activados en tu perfil.',
  /** Anyone writing from a chat that isn't linked to an account (or with a bad or expired code). */
  notLinked:
    'Hola, soy Mimo, de Mimoia, una inteligencia artificial. Para hablar conmigo aquí, conecta Telegram desde tu perfil en mimoia.com.',
  /** Voice notes, photos, stickers…: piece 1 reads text only. */
  unsupported: 'Por aquí, de momento, solo leo mensajes de texto. ¿Me lo escribes?',
}
