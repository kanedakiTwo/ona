"use client"

/**
 * Animated entry splash — shown on the very first client render of the
 * session, then fades out.
 *
 * Why this exists alongside `app/loading.tsx`:
 *   - `app/loading.tsx` is rendered by Next.js during a Suspense boundary
 *     (initial hydration, slow data fetches). On a fast bundle it's gone
 *     in well under 100 ms, which is why "no he visto mejora ninguna" —
 *     the user never gets to see it.
 *   - The OS-level PWA splash (`splash-*.png`) is a static image and
 *     can't animate.
 *
 * This component sits as the first child of the root layout and shows
 * for a deliberate minimum of ~1.6 s on the first mount of the tab,
 * regardless of how fast the rest of the app is. Subsequent route
 * navigations don't re-trigger it (it remembers via a session ref).
 *
 * Visual is the same ink-in-water vocabulary as `app/loading.tsx`: three
 * drops on cream morphing between two organic silhouettes, soft Gaussian
 * blur on the centre drop, "Ona" italic underneath. We do not import the
 * loading.tsx directly because Next.js owns that file; copying the
 * markup keeps the two surfaces decoupled.
 */
import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"

const EASE = [0.65, 0, 0.35, 1] as const

const DROP_A = [
  "M50,15 C68,18 80,32 80,52 C80,72 65,87 50,87 C35,87 20,72 20,52 C20,32 32,18 50,15 Z",
  "M50,22 C72,22 82,40 80,58 C77,76 60,90 48,88 C30,84 18,68 22,48 C26,30 38,22 50,22 Z",
] as const

const DROP_B = [
  "M50,20 C66,22 76,38 74,55 C72,72 58,85 48,84 C36,82 28,68 30,52 C32,36 40,22 50,20 Z",
  "M50,18 C72,24 78,44 70,62 C62,80 46,86 38,80 C26,72 24,52 32,38 C38,28 44,16 50,18 Z",
] as const

const DROP_C = [
  "M50,28 C62,30 70,42 68,55 C66,68 58,78 50,76 C42,74 36,62 38,50 C40,38 46,28 50,28 Z",
  "M50,32 C66,30 74,46 70,60 C66,72 52,80 44,76 C34,70 30,56 36,44 C40,36 46,34 50,32 Z",
] as const

// Once we've shown the splash this session, don't show it again on
// soft-navigation re-mounts. Survives across PageTransition cycles
// because it's a module-level boolean, not React state.
let splashShownThisSession = false

export function ClientSplash() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (splashShownThisSession) return
    splashShownThisSession = true
    setVisible(true)
    // Visible for 1.6 s — long enough to read the animation, short
    // enough to not feel slow. The fade-out adds another 350 ms.
    const id = setTimeout(() => setVisible(false), 1600)
    return () => clearTimeout(id)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#FAF6EE] grain-subtle"
          // Lock pointer/scroll while the splash is up.
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 300 300"
            width="220"
            height="220"
            aria-hidden="true"
            className="select-none"
          >
            <defs>
              <filter id="splash-ink-bleed" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.4" />
              </filter>
            </defs>
            <motion.path
              fill="#1A1612"
              fillOpacity={0.78}
              initial={{ x: 0, y: 0, scale: 1 }}
              animate={{
                d: [DROP_A[0], DROP_A[1], DROP_A[0]],
                x: [0, -22, 4, 0],
                y: [0, -10, 6, 0],
                scale: [1, 1.05, 0.96, 1],
              }}
              transition={{ duration: 4.5, ease: EASE, repeat: Infinity }}
              style={{ transformOrigin: "150px 150px" }}
              transform="translate(70, 100)"
            />
            <motion.g filter="url(#splash-ink-bleed)">
              <motion.path
                fill="#1A1612"
                initial={{ scale: 1 }}
                animate={{
                  d: [DROP_B[0], DROP_B[1], DROP_B[0]],
                  scale: [1, 1.08, 0.97, 1],
                }}
                transition={{ duration: 3.6, ease: EASE, repeat: Infinity }}
                style={{ transformOrigin: "150px 150px" }}
                transform="translate(100, 100)"
              />
            </motion.g>
            <motion.path
              fill="#1A1612"
              fillOpacity={0.68}
              initial={{ x: 0, y: 0 }}
              animate={{
                d: [DROP_C[0], DROP_C[1], DROP_C[0]],
                x: [0, 18, -6, 0],
                y: [0, 8, -4, 0],
                scale: [0.85, 0.95, 0.82, 0.85],
              }}
              transition={{ duration: 5.2, ease: EASE, repeat: Infinity }}
              style={{ transformOrigin: "150px 150px" }}
              transform="translate(130, 100)"
            />
          </svg>
          <motion.div
            className="mt-10 font-display italic text-[#1A1612]"
            initial={{ opacity: 0.18 }}
            animate={{ opacity: [0.18, 0.5, 0.18] }}
            transition={{ duration: 2.4, ease: EASE, repeat: Infinity }}
            style={{ fontSize: "1.1rem", letterSpacing: "0.04em" }}
          >
            Ona
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
