/**
 * The delayed mic start of `open({ listen: true })` (PRO-79, MimoProvider).
 * The panel opens first and the mic starts a moment later; that start must
 * be cancellable, so «Parar», turning hands-free off or closing the panel
 * inside the delay leaves the mic off. Pure, so the API's vitest suite can
 * pin it (apps/api/src/tests/mimoPendingListen.test.ts).
 */
export function createPendingListen() {
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  return {
    schedule(listen: () => void, delayMs: number) {
      cancel()
      timer = setTimeout(() => {
        timer = null
        listen()
      }, delayMs)
    },
    cancel,
    isPending: () => timer !== null,
  }
}
