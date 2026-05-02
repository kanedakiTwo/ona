/**
 * Tiny pure helper to classify a URL as a YouTube video or a generic article.
 * Lives in its own file so unit tests can import it without dragging in the
 * orchestrator's network/LLM dependencies.
 */
export type UrlSourceType = 'youtube' | 'article'

const YT_HOSTS = new Set([
  'youtu.be',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
])

export function detectSourceType(input: string): UrlSourceType {
  const url = new URL(input) // throws on invalid input
  return YT_HOSTS.has(url.hostname.toLowerCase()) ? 'youtube' : 'article'
}
