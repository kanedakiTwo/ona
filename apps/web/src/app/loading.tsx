/**
 * Global loading state — App Router shows this during the root Suspense
 * boundary (initial server hydration, slow data fetches that don't have
 * a closer `loading.tsx`).
 *
 * Visual: ink-in-water vibe. Three black drops on cream, each morphing
 * slowly between two organic shapes via SVG path `d` interpolation, with
 * a soft gaussian-blur "ink bleed" filter behind the central drop.
 * Editorial Fraunces wordmark underneath, low opacity, pulse-fading in
 * lockstep with the drops.
 *
 * Tone: calm, considered, not bouncy. ~6-10 s loops, ease curves that
 * lean into the start and overshoot the end gently (cubic-bezier
 * [0.65, 0, 0.35, 1]) so the morph feels like ink dispersing in water.
 */

"use client"

import { motion } from "motion/react"

const EASE = [0.65, 0, 0.35, 1] as const

// Two organic shapes per drop, expressed as SVG path `d` strings. Both
// describe roughly the same area so the morph reads as a state change
// in the same droplet rather than a teleport. Coordinates are in a
// local 0..100 viewBox; the parent <svg> scales the whole composition.
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

export default function Loading() {
  return (
    <div className="fixed inset-0 z-[120] flex flex-col items-center justify-center bg-[#FAF6EE] grain-subtle">
      <svg
        viewBox="0 0 300 300"
        width="220"
        height="220"
        aria-hidden="true"
        className="select-none"
      >
        <defs>
          <filter id="ink-bleed" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        </defs>

        {/* Left drop — drifts left + up, morphs slowly */}
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
          transition={{
            duration: 9,
            ease: EASE,
            repeat: Infinity,
            repeatType: "loop",
          }}
          style={{ transformOrigin: "150px 150px" }}
          transform="translate(70, 100)"
        />

        {/* Center drop — biggest, anchors the composition, has the bleed */}
        <motion.g filter="url(#ink-bleed)">
          <motion.path
            fill="#1A1612"
            initial={{ scale: 1 }}
            animate={{
              d: [DROP_B[0], DROP_B[1], DROP_B[0]],
              scale: [1, 1.08, 0.97, 1],
            }}
            transition={{
              duration: 7.5,
              ease: EASE,
              repeat: Infinity,
              repeatType: "loop",
            }}
            style={{ transformOrigin: "150px 150px" }}
            transform="translate(100, 100)"
          />
        </motion.g>

        {/* Right drop — smaller, drifts right + down */}
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
          transition={{
            duration: 11,
            ease: EASE,
            repeat: Infinity,
            repeatType: "loop",
          }}
          style={{ transformOrigin: "150px 150px" }}
          transform="translate(130, 100)"
        />

        {/* Two trailing dots — small, slow, low opacity. Anchor the
            composition's edges so the eye reads a constellation. */}
        <motion.circle
          cx={62}
          cy={188}
          r={3.6}
          fill="#1A1612"
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0, 0.45, 0],
            cy: [188, 196, 188],
            r: [3.6, 2.4, 3.6],
          }}
          transition={{
            duration: 8.5,
            ease: EASE,
            repeat: Infinity,
            delay: 1.2,
          }}
        />
        <motion.circle
          cx={238}
          cy={92}
          r={2.6}
          fill="#1A1612"
          initial={{ opacity: 0 }}
          animate={{
            opacity: [0, 0.35, 0],
            cy: [92, 86, 92],
          }}
          transition={{
            duration: 6.8,
            ease: EASE,
            repeat: Infinity,
            delay: 3.4,
          }}
        />
      </svg>

      <motion.div
        className="mt-10 font-display italic text-[#1A1612]"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.18, 0.36, 0.18] }}
        transition={{ duration: 5, ease: EASE, repeat: Infinity }}
        style={{ fontSize: "0.95rem", letterSpacing: "0.04em" }}
      >
        Ona
      </motion.div>
    </div>
  )
}
