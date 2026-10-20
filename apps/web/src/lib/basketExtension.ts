/**
 * Mensajes con la extensión del navegador que suma la cesta del súper al
 * carro de la cadena (specs/shop-orders.md). `chrome.runtime.sendMessage`
 * solo existe si la extensión declara este origen en `externally_connectable`.
 * Puede haber una extensión por cadena: `NEXT_PUBLIC_BASKET_EXTENSION_ID` lleva
 * sus ids separados por comas y la web usa la que sabe llenar la web de la tienda.
 */
import { BASKET_EXTENSION_PROTOCOL, parseExtensionIds, type BasketMessage, type BasketPing } from "@ona/shared"

export const BASKET_EXTENSION_IDS = parseExtensionIds(process.env.NEXT_PUBLIC_BASKET_EXTENSION_ID)
/**
 * Espera máxima a `enviar` y a `deshacer`. La extensión deja de escribir a los
 * 150 s y verifica después: 180 s lo cubre. Si aun así se pasa, al volver a
 * pulsar llega el `repetido` con lo que hizo.
 */
export const SEND_TIMEOUT_MS = 180_000

type Runtime = { sendMessage?: (id: string, msg: unknown, cb: (r: unknown) => void) => void; lastError?: unknown }

function runtime(): Runtime | null {
  if (typeof window === "undefined" || BASKET_EXTENSION_IDS.length === 0) return null
  const rt = (window as unknown as { chrome?: { runtime?: Runtime } }).chrome?.runtime
  return rt?.sendMessage ? rt : null
}

/**
 * Qué pasó con un mensaje:
 * - `answer`: la extensión contestó (la forma de `value` está sin comprobar);
 * - `none`: no hay extensión en este navegador (sin `chrome.runtime`, `lastError`, sin respuesta o error al mandar);
 * - `timeout`: se acabó el tiempo sin respuesta (puede que la extensión siga trabajando).
 */
export type ExtensionReply<T> = { kind: "answer"; value: T } | { kind: "none" } | { kind: "timeout" }

/**
 * Como `askExtension`, pero distingue «no hay extensión» de «se acabó el tiempo». Nunca lanza.
 * `id`: la extensión a la que se habla (por defecto, la primera de la build).
 */
export function messageExtension<T>(msg: BasketMessage, timeoutMs: number, id: string | null = BASKET_EXTENSION_IDS[0] ?? null): Promise<ExtensionReply<T>> {
  const rt = runtime()
  if (!rt || !id) return Promise.resolve({ kind: "none" })
  return new Promise((resolve) => {
    let done = false
    const finish = (v: ExtensionReply<T>) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs)
    try {
      rt.sendMessage!(id, msg, (resp) =>
        finish(rt.lastError || resp == null ? { kind: "none" } : { kind: "answer", value: resp as T }),
      )
    } catch {
      finish({ kind: "none" })
    }
  })
}

/** null = no hay extensión, no contesta, da error o se acaba el tiempo. Nunca lanza. */
export async function askExtension<T>(msg: BasketMessage, timeoutMs: number, id?: string | null): Promise<T | null> {
  const r = await messageExtension<T>(msg, timeoutMs, id)
  return r.kind === "answer" ? r.value : null
}

export async function pingExtension(id?: string | null): Promise<BasketPing | null> {
  const r = await askExtension<BasketPing>({ protocolo: BASKET_EXTENSION_PROTOCOL, tipo: "ping" }, 1500, id)
  return r &&
    r.ok === true &&
    r.protocolo === BASKET_EXTENSION_PROTOCOL &&
    typeof r.etiqueta === "string" &&
    r.etiqueta.trim() !== "" &&
    Array.isArray(r.hosts) &&
    r.hosts.every((h) => typeof h === "string")
    ? r
    : null
}

/** `ping` a todas las extensiones de la build a la vez; solo las que contestan bien, en el orden de la build. */
export async function pingExtensions(): Promise<Array<{ id: string; ping: BasketPing }>> {
  const pings = await Promise.all(BASKET_EXTENSION_IDS.map(async (id) => ({ id, ping: await pingExtension(id) })))
  return pings.filter((p): p is { id: string; ping: BasketPing } => p.ping !== null)
}

export function hostOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
}
