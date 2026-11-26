/**
 * 24-nov: Mimo ends a short-choice question with `[[opciones: Comida | Cena]]`.
 * WhatsApp turns that line into reply buttons (`extractOptions` in the API);
 * the web panel showed it as written. Here the same line comes out of the text
 * and becomes the buttons under Mimo's last message. Pure, no React.
 */
export const MIMO_MAX_OPTIONS = 6

export function mimoOptions(content: string): { text: string; options: string[] } {
  let options: string[] = []
  const text = content
    .replace(/\[\[\s*opci[oó]n(?:es)?\s*:\s*([^\]]*)\]\]/gi, (_all, list: string) => {
      if (options.length === 0) {
        options = list
          .split('|')
          .map((o) => o.trim())
          .filter(Boolean)
      }
      return ''
    })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, options: options.slice(0, MIMO_MAX_OPTIONS) }
}
