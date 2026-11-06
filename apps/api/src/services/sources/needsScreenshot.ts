/**
 * A link we can't read, whose plan B is a screenshot (photo import): an
 * Instagram/TikTok caption without the recipe, or a page that gives us no
 * text (anti-bot wall, JS-only page). The web route answers
 * `422 { code: 'NEEDS_SCREENSHOT' }`; Mimo relays the sentence.
 */
export class NeedsScreenshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NeedsScreenshotError'
  }
}
