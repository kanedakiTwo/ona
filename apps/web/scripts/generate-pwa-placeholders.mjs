// PWA asset generator — ink-drop isotype + splash imagotipo.
//
// Picks up the visual language of `app/loading.tsx` (organic ink drops on
// cream) so the home-screen icon, notification badge and startup splash
// all read as "the same brand" instead of the flat ONA wordmark we shipped
// as a placeholder.
//
// Run from apps/web: node scripts/generate-pwa-placeholders.mjs

import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(__dirname, "..")
const OUT_ICONS = path.join(WEB_ROOT, "public/icons")
const OUT_FAVICON = path.join(WEB_ROOT, "public/favicon.ico")
const CREAM = "#FAF6EE"
const INK = "#1A1612"
const TERRACOTTA = "#C65D38"

await fs.mkdir(OUT_ICONS, { recursive: true })

// ── Drop paths (visual vocabulary inherited from loading.tsx) ────────────
//
// Centred single-drop silhouette in a 100×100 viewBox. The original
// loading.tsx drops weren't symmetric; we tightened them here so the
// shape reads well even at 32 px (favicon) without looking like a clean
// teardrop — a hint of asymmetry on the upper-right side keeps the hand-
// painted feel.
const DROP_MAIN =
  "M50,12 C70,14 82,30 80,52 C78,74 62,88 50,88 C38,88 22,74 20,52 C18,30 30,14 50,12 Z"
// Small accent drop — only used on the splash composition, never on the
// app icons (it visually unbalances the silhouette at small sizes).
const DROP_ACCENT =
  "M72,22 C80,22 84,30 82,38 C80,46 70,48 67,42 C64,36 66,22 72,22 Z"

// ── Isotype SVG (used for every app icon variant) ─────────────────────────
//
// `safeZonePct` controls how much of the canvas the drop occupies:
//   - 0.62 for the standard icon (drop fills ~62 % of the smaller side).
//   - 0.48 for the maskable icon, which Android crops aggressively.
//   - 0.82 for the monochrome notification icon (single colour, no bg,
//     needs to read clearly on a tinted background).
function svgIsotype({ size, bg, fg, safeZonePct }) {
  const drawSize = size * safeZonePct
  const offset = (size - drawSize) / 2
  const scale = drawSize / 100
  const bgRect = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ""
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${bgRect}
    <g transform="translate(${offset}, ${offset}) scale(${scale})" fill="${fg}">
      <path d="${DROP_MAIN}" />
    </g>
  </svg>`
}

// ── Splash imagotipo: isotype + "Ona" wordmark + soft accent ──────────────
function svgSplash({ width, height }) {
  const cx = width / 2
  const cy = height / 2
  // Drop ~22 % of the shorter side, sitting above the wordmark.
  const dropDraw = Math.min(width, height) * 0.22
  const dropOffsetY = cy - dropDraw / 2 - dropDraw * 0.4
  const dropScale = dropDraw / 100
  const dropX = cx - dropDraw / 2
  const wordmarkSize = Math.round(Math.min(width, height) * 0.085)
  const wordmarkY = cy + dropDraw * 0.55
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${CREAM}"/>
    <g transform="translate(${dropX}, ${dropOffsetY}) scale(${dropScale})" fill="${INK}">
      <path d="${DROP_MAIN}" />
      <path d="${DROP_ACCENT}" opacity="0.55" />
    </g>
    <text x="50%" y="${wordmarkY}" text-anchor="middle" dominant-baseline="central"
      font-family="'Fraunces', Georgia, 'Times New Roman', serif"
      font-style="italic" font-weight="400" font-size="${wordmarkSize}"
      fill="${INK}" letter-spacing="0.02em">Ona</text>
    <circle cx="${cx}" cy="${wordmarkY + wordmarkSize * 0.75}" r="${wordmarkSize * 0.08}" fill="${TERRACOTTA}"/>
  </svg>`
}

async function writePng(svg, outPath) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath)
  console.log("  →", path.relative(process.cwd(), outPath))
}

// ── Icons ──────────────────────────────────────────────────────────────────
console.log("Icons (isotype):")
await writePng(
  svgIsotype({ size: 192, bg: CREAM, fg: INK, safeZonePct: 0.62 }),
  path.join(OUT_ICONS, "icon-192.png"),
)
await writePng(
  svgIsotype({ size: 512, bg: CREAM, fg: INK, safeZonePct: 0.62 }),
  path.join(OUT_ICONS, "icon-512.png"),
)
// Maskable: the drop lives in the central 48 % so Android's circle/square
// crop doesn't lop off the secondary droplet.
await writePng(
  svgIsotype({ size: 192, bg: CREAM, fg: INK, safeZonePct: 0.48 }),
  path.join(OUT_ICONS, "icon-192-maskable.png"),
)
await writePng(
  svgIsotype({ size: 512, bg: CREAM, fg: INK, safeZonePct: 0.48 }),
  path.join(OUT_ICONS, "icon-512-maskable.png"),
)
// Monochrome: no background — single-colour silhouette for the
// notification status bar tint. Drop occupies more of the canvas because
// Android shrinks it inside its own padded badge.
await writePng(
  svgIsotype({ size: 512, bg: null, fg: INK, safeZonePct: 0.82 }),
  path.join(OUT_ICONS, "icon-monochrome.png"),
)
await writePng(
  svgIsotype({ size: 180, bg: CREAM, fg: INK, safeZonePct: 0.62 }),
  path.join(OUT_ICONS, "apple-touch-icon.png"),
)

// ── Favicon ─────────────────────────────────────────────────────────────────
// 32×32 drop. Browsers will treat the PNG-in-ICO container fine.
console.log("Favicon:")
const favIco = await sharp(
  Buffer.from(svgIsotype({ size: 32, bg: CREAM, fg: INK, safeZonePct: 0.68 })),
)
  .resize(32, 32)
  .png()
  .toBuffer()
await fs.writeFile(OUT_FAVICON, favIco)
console.log("  →", path.relative(process.cwd(), OUT_FAVICON))

// ── Splash screens — imagotipo (drop + "Ona" italic wordmark) ─────────────
console.log("Splash screens (imagotipo):")
const SPLASHES = [
  { name: "splash-2048x2732.png", w: 2048, h: 2732 }, // iPad Pro 12.9
  { name: "splash-1668x2388.png", w: 1668, h: 2388 }, // iPad Pro 11
  { name: "splash-1536x2048.png", w: 1536, h: 2048 }, // iPad mini/Air
  { name: "splash-1290x2796.png", w: 1290, h: 2796 }, // iPhone 14 Pro Max
  { name: "splash-1179x2556.png", w: 1179, h: 2556 }, // iPhone 14 Pro / 15
  { name: "splash-1170x2532.png", w: 1170, h: 2532 }, // iPhone 13/14/15
  { name: "splash-1125x2436.png", w: 1125, h: 2436 }, // iPhone X/11 Pro/12 mini
  { name: "splash-1242x2688.png", w: 1242, h: 2688 }, // iPhone 11 Pro Max / XS Max
]
for (const s of SPLASHES) {
  await writePng(svgSplash({ width: s.w, height: s.h }), path.join(OUT_ICONS, s.name))
}

console.log("\nDone. The drop is the placeholder imagotipo — replace these PNGs with the final branded artwork when ready.")
