"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { WifiOff } from "lucide-react"
import { forgetNetworkCheck, isOffline } from "@/lib/pwa/network"

/** While the banner is up, look again this often: a network that comes back without an `online` event hides it. */
const RECHECK_MS = 10_000

export default function OfflineBanner() {
  const [mounted, setMounted] = useState(false)
  const [offline, setIsOffline] = useState(false)

  useEffect(() => {
    setMounted(true)
    let cancelled = false

    // PRO-1036: `navigator.onLine` false alone doesn't raise the banner — isOffline() checks the network.
    const check = async () => {
      const offline = await isOffline()
      if (!cancelled) setIsOffline(offline)
    }
    void check()

    const handleOnline = () => {
      forgetNetworkCheck()
      setIsOffline(false)
    }
    const handleOffline = () => {
      forgetNetworkCheck()
      void check()
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      cancelled = true
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!offline) return
    const timer = setInterval(async () => {
      forgetNetworkCheck()
      if (!(await isOffline())) setIsOffline(false)
    }, RECHECK_MS)
    return () => clearInterval(timer)
  }, [offline])

  // Avoid SSR/hydration mismatch — only render banner contents after mount
  if (!mounted) return null

  return (
    <AnimatePresence>
      {offline && (
        <motion.div
          key="offline-banner"
          role="status"
          aria-live="polite"
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -60, opacity: 0 }}
          transition={{ ease: [0.19, 1, 0.22, 1], duration: 0.3 }}
          className="pointer-events-none fixed left-0 right-0 top-0 z-40 bg-warn-bg"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <div className="mx-auto flex max-w-[430px] items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-warn-text">
            <WifiOff size={16} strokeWidth={2} />
            <span>Sin conexión</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
