export interface ShareInput {
  title?: string
  text?: string
  url?: string
}

export type ShareResult = { method: "native" | "clipboard"; success: boolean }

export async function share(input: ShareInput): Promise<ShareResult> {
  // Try native share first
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share(input)
      return { method: "native", success: true }
    } catch (err) {
      // User dismissed or permission denied — fall through to clipboard
      // Distinguish AbortError (user dismissed) — still return success: false
      if (err instanceof DOMException && err.name === "AbortError") {
        return { method: "native", success: false }
      }
    }
  }

  // Fallback: clipboard
  const fallbackText = input.text ?? input.url ?? input.title ?? ""
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(fallbackText)
      return { method: "clipboard", success: true }
    } catch {
      return { method: "clipboard", success: false }
    }
  }

  return { method: "clipboard", success: false }
}
