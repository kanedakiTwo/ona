"use client"

/**
 * Animated entry splash — second iteration.
 *
 * Narrative (~2 s):
 *   t=0.00   A black ink droplet starts falling from above the centre.
 *            It's elongated (water-drop shape) and accelerates with a
 *            gravity ease.
 *   t≈0.55   Impact at centre. The droplet squashes briefly (rx grows,
 *            ry shrinks) then settles to a small organic blob.
 *   t≈0.60   A first ripple ring radiates outward, thinning + fading.
 *   t≈0.78   A second, fainter ripple follows — staggered, smaller.
 *   t≈0.85   A tiny secondary droplet falls off-axis (smaller, left of
 *            centre). Adds asymmetry + a hand-painted feel.
 *   t≈1.10   "Ona" italic Fraunces wordmark fades in below the impact,
 *            letter by letter (O-n-a, 80 ms apart).
 *   t≈1.45   A small terracotta dot pulses under the wordmark — the
 *            single chromatic note in the composition; reads as a
 *            "stamp of approval" or seal.
 *   t≈1.85   Hold.
 *   t≈2.05   Whole splash fades out over 350 ms.
 *
 * Decisions worth recording:
 *   - 220×220 SVG inside a centred flex container so the impact origin
 *     sits at the optical centre of the viewport. The motion lives in a
 *     400×400 viewBox so the ripples have room to expand past the
 *     visible silhouette.
 *   - Single colour (#1A1612 ink) for the entire ink composition; the
 *     only chromatic accent is the terracotta dot at the end. Keeps the
 *     piece feeling like a single editorial gesture instead of a UI.
 *   - The OS-level static splash (`splash-*.png`) covers the bundle-
 *     load window before this JS runs, so the cream background of this
 *     component matches the static splash's cream → the user sees one
 *     continuous frame, not a flash.
 *
 * Replays per session: module-level boolean. Even if the React tree
 * remounts (PageTransition / route change), the splash only shows on
 * the FIRST tab load.
 */
import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"

let splashShownThisSession = false

// Sequence anchor points (seconds). Tweaking these in one place keeps
// the choreography in sync.
const T = {
  fallStart: 0,
  impact: 0.55,
  rippleA: 0.6,
  rippleB: 0.78,
  secondaryDrop: 0.85,
  wordmark: 1.1,
  accent: 1.45,
  hold: 1.85,
  total: 2.05,
} as const

// Cubic-bezier curves picked by feel: `gravity` accelerates the fall
// then snaps, `settle` is the post-impact rest curve.
const GRAVITY: [number, number, number, number] = [0.55, 0, 0.85, 0.25]
const SETTLE: [number, number, number, number] = [0.16, 1, 0.3, 1]

export function ClientSplash() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (splashShownThisSession) return
    splashShownThisSession = true
    setVisible(true)
    const id = setTimeout(() => setVisible(false), T.total * 1000)
    return () => clearTimeout(id)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: SETTLE }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#FAF6EE] grain-subtle"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 400 400"
            width="260"
            height="260"
            className="select-none"
            aria-hidden="true"
          >
            <defs>
              <filter
                id="splash-bleed"
                x="-30%"
                y="-30%"
                width="160%"
                height="160%"
                filterUnits="objectBoundingBox"
              >
                <feGaussianBlur stdDeviation="2.2" />
              </filter>
              <radialGradient id="splash-ripple-grad">
                <stop offset="0%" stopColor="#1A1612" stopOpacity="0" />
                <stop offset="80%" stopColor="#1A1612" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#1A1612" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Ripple A — wide, slow, fades out as it expands. */}
            <motion.circle
              cx={200}
              cy={200}
              fill="none"
              stroke="#1A1612"
              initial={{ r: 4, opacity: 0, strokeWidth: 3 }}
              animate={{
                r: [4, 160],
                opacity: [0, 0.32, 0],
                strokeWidth: [3, 0.4],
              }}
              transition={{
                duration: 1.2,
                delay: T.rippleA,
                times: [0, 0.5, 1],
                ease: "easeOut",
              }}
            />
            {/* Ripple B — tighter, slightly delayed; the "echo". */}
            <motion.circle
              cx={200}
              cy={200}
              fill="none"
              stroke="#1A1612"
              initial={{ r: 4, opacity: 0, strokeWidth: 2 }}
              animate={{
                r: [4, 95],
                opacity: [0, 0.22, 0],
                strokeWidth: [2, 0.3],
              }}
              transition={{
                duration: 1.1,
                delay: T.rippleB,
                times: [0, 0.5, 1],
                ease: "easeOut",
              }}
            />

            {/* Soft ink bleed bloom — radial gradient expanding briefly
                after impact so the drop appears to disperse in water. */}
            <motion.circle
              cx={200}
              cy={200}
              fill="url(#splash-ripple-grad)"
              initial={{ r: 0, opacity: 0 }}
              animate={{
                r: [10, 70, 90],
                opacity: [0, 0.9, 0],
              }}
              transition={{
                duration: 0.95,
                delay: T.rippleA - 0.05,
                times: [0, 0.45, 1],
                ease: "easeOut",
              }}
            />

            {/* Main drop. Two phases composed via keyframes:
                  1. Fall: y from -180 → 0 (relative to centre 200);
                     rx 12 → 14 (slight stretch); ry 22 → 18 (elongates
                     less as it accelerates).
                  2. Impact + settle: ry crushes to 7, rx fans to 22,
                     then both relax to 16/19 final. */}
            <motion.ellipse
              cx={200}
              fill="#1A1612"
              filter="url(#splash-bleed)"
              initial={{ cy: 20, rx: 11, ry: 20, opacity: 0 }}
              animate={{
                cy: [20, 200, 200, 200],
                rx: [11, 14, 22, 16],
                ry: [20, 18, 7, 19],
                opacity: [0, 1, 1, 1],
              }}
              transition={{
                duration: 1.05,
                times: [0, T.impact / 1.05, (T.impact + 0.15) / 1.05, 1],
                ease: [GRAVITY, GRAVITY, SETTLE],
              }}
            />

            {/* Secondary drop — falls off-axis with a beat of delay so it
                doesn't compete with the main impact. Smaller, slightly to
                the left, less opaque. */}
            <motion.ellipse
              cx={158}
              fill="#1A1612"
              fillOpacity={0.72}
              initial={{ cy: 30, rx: 6, ry: 12, opacity: 0 }}
              animate={{
                cy: [30, 220, 220],
                rx: [6, 8, 11],
                ry: [12, 11, 4],
                opacity: [0, 1, 1],
              }}
              transition={{
                duration: 0.7,
                delay: T.secondaryDrop,
                times: [0, 0.7, 1],
                ease: [GRAVITY, SETTLE],
              }}
            />
            {/* Echo ripple around the secondary drop's landing. */}
            <motion.circle
              cx={158}
              cy={220}
              fill="none"
              stroke="#1A1612"
              initial={{ r: 0, opacity: 0, strokeWidth: 1.4 }}
              animate={{
                r: [0, 40],
                opacity: [0, 0.2, 0],
                strokeWidth: [1.4, 0.2],
              }}
              transition={{
                duration: 0.7,
                delay: T.secondaryDrop + 0.4,
                times: [0, 0.6, 1],
                ease: "easeOut",
              }}
            />
          </svg>

          {/* Wordmark — letter stagger. "O" lands first, "n" 80 ms after,
              "a" 80 ms after that. Each fades in + nudges up 4 px. */}
          <div className="mt-6 flex font-display italic text-[#1A1612]" style={{ fontSize: "1.5rem", letterSpacing: "0.04em" }}>
            {["O", "n", "a"].map((ch, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 0.85, y: 0 }}
                transition={{
                  delay: T.wordmark + i * 0.08,
                  duration: 0.45,
                  ease: SETTLE,
                }}
              >
                {ch}
              </motion.span>
            ))}
          </div>

          {/* Terracotta seal — single chromatic note. Pulses once on
              entry so the eye lands on it after the wordmark resolves. */}
          <motion.div
            className="mt-3 h-[7px] w-[7px] rounded-full bg-[#C65D38]"
            initial={{ scale: 0, opacity: 0 }}
            animate={{
              scale: [0, 1.4, 1],
              opacity: [0, 1, 0.85],
            }}
            transition={{
              delay: T.accent,
              duration: 0.55,
              times: [0, 0.55, 1],
              ease: SETTLE,
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
