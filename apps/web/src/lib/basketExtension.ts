/**
 * Mensajes con la extensión del navegador que suma la cesta del súper al
 * carro de la cadena (specs/shop-orders.md). `chrome.runtime.sendMessage`
 * solo existe si la extensión declara este origen en `externally_connectable`.
 */
import { BASKET_EXTENSION_PROTOCOL, type BasketMessage, type BasketPing } from "@ona/shared"

export const BASKET_EXTENSION_ID = process.env.NEXT_PUBLIC_BASKET_EXTENSION_ID ?? ""
/** Peor caso de un envío: 40 búsquedas a 1,2 s + carro + 3 relecturas ≈ 70 s. */
export const SEND_TIMEOUT_MS = 180_000

type Runtime = { sendMessage?: (id: string, msg: unknown, cb: (r: unknown) => void) => void; lastError?: unknown }

function runtime(): Runtime | null {
  if (typeof window === "undefined" || !BASKET_EXTENSION_ID) return null
  const rt = (window as unknown as { chrome?: { runtime?: Runtime } }).chrome?.runtime
  return rt?.sendMessage ? rt : null
}

/** null = no hay extensión, no contesta, da error o se acaba el tiempo. Nunca lanza. */
export function askExtension<T>(msg: BasketMessage, timeoutMs: number): Promise<T | null> {
  const rt = runtime()
  if (!rt) return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const finish = (v: T | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    try {
      rt.sendMessage!(BASKET_EXTENSION_ID, msg, (resp) => finish(rt.lastError || resp == null ? null : (resp as T)))
    } catch {
      finish(null)
    }
  })
}

export async function pingExtension(): Promise<BasketPing | null> {
  const r = await askExtension<BasketPing>({ protocolo: BASKET_EXTENSION_PROTOCOL, tipo: "ping" }, 1500)
  return r && r.ok === true && r.protocolo === BASKET_EXTENSION_PROTOCOL && Array.isArray(r.hosts) ? r : null
}

export function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
}
