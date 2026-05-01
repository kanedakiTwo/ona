type Sentinel = WakeLockSentinel | null

let activeSentinel: Sentinel = null
let visibilityHandlerAttached = false

async function requestLock(): Promise<Sentinel> {
  if (typeof navigator === "undefined") return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wl = (navigator as any).wakeLock
  if (!wl?.request) return null
  try {
    return await wl.request("screen")
  } catch {
    return null
  }
}

function attachVisibilityHandler() {
  if (visibilityHandlerAttached || typeof document === "undefined") return
  document.addEventListener("visibilitychange", async () => {
    // If we had a lock and the tab became visible again, re-acquire
    if (activeSentinel !== null && document.visibilityState === "visible") {
      activeSentinel = await requestLock()
    }
  })
  visibilityHandlerAttached = true
}

export async function acquireWakeLock(): Promise<Sentinel> {
  attachVisibilityHandler()
  activeSentinel = await requestLock()
  return activeSentinel
}

export async function releaseWakeLock(sentinel: Sentinel = activeSentinel): Promise<void> {
  if (!sentinel) return
  try {
    await sentinel.release()
  } catch {
    // ignore — already released
  }
  if (sentinel === activeSentinel) {
    activeSentinel = null
  }
}
