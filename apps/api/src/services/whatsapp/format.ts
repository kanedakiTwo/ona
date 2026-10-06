/**
 * Pure text helpers for WhatsApp output.
 *
 * WhatsApp markup: *bold*, _italic_, ~strike~, ```mono```, "- " / "* " lists.
 * No headings, tables or [text](url) links — convert what the model might
 * still emit despite the prompt.
 */

export const WA_TEXT_MAX = 4096
export const WA_BUTTON_BODY_MAX = 1024
export const WA_BUTTON_TITLE_MAX = 20
export const WA_MAX_BUTTONS = 3

export function toWhatsAppMarkup(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1: $2')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The WhatsApp system prompt asks the model to end yes/no or short-choice
 * questions with `[[opciones: Sí | No]]`. Pull that line out so the
 * renderer can turn it into native reply buttons. More than 3 options (the
 * WhatsApp limit) are folded back into the text instead.
 */
export function extractOptions(input: string): { text: string; options: string[] } {
  const re = /\[\[\s*opciones?\s*:\s*([^\]]+)\]\]/i
  const m = re.exec(input)
  if (!m) return { text: input, options: [] }
  const text = input.replace(re, '').replace(/[ \t]+\n/g, '\n').trim()
  const options = m[1]
    .split('|')
    .map((o) => o.trim())
    .filter(Boolean)
  if (options.length === 0) return { text, options: [] }
  if (options.length > WA_MAX_BUTTONS) {
    return { text: `${text}\n\n${options.map((o) => `- ${o}`).join('\n')}`.trim(), options: [] }
  }
  return {
    text,
    options: options.map((o) =>
      o.length > WA_BUTTON_TITLE_MAX ? `${o.slice(0, WA_BUTTON_TITLE_MAX - 1)}…` : o,
    ),
  }
}

/** Split on paragraph, then line, then hard boundaries to stay ≤ `max`. */
export function splitMessage(input: string, max: number = WA_TEXT_MAX): string[] {
  const text = input.trim()
  if (text.length <= max) return text ? [text] : []
  const chunks: string[] = []
  let rest = text
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let cut = window.lastIndexOf('\n\n')
    if (cut < max * 0.5) cut = window.lastIndexOf('\n')
    if (cut < max * 0.5) cut = window.lastIndexOf(' ')
    if (cut <= 0) cut = max
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) chunks.push(rest)
  return chunks
}
