// Placeholder PWA asset generator.
// Builds a single SVG source per icon variant and rasterizes it via sharp.
// All assets land in apps/web/public/icons/ (and favicon.ico at apps/web/public/).
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

// ── Wordmark SVG ───────────────────────────────────────────────────────────
// Big bold "ONA" in editorial-style wordmark on cream background.
function svgIcon({ size, bg, fg, scale = 0.36 }) {
  const fontSize = Math.round(size * scale)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${bg}"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
      font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${fontSize}"
      fill="${fg}" letter-spacing="-0.04em">ONA</text>
  </svg>`
}

// Maskable: same wordmark but logo lives in central 80% safe-zone.
function svgMaskable({ size }) {
  const safe = size * 0.8
  const fontSize = Math.round(safe * 0.42)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${CREAM}"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
      font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${fontSize}"
      fill="${INK}" letter-spacing="-0.04em">ONA</text>
  </svg>`
}

// Monochrome: alpha mask, single-color silhouette of "ONA" on transparent bg.
function svgMonochrome({ size }) {
  const fontSize = Math.round(size * 0.42)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
      font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${fontSize}"
      fill="${INK}" letter-spacing="-0.04em">ONA</text>
  </svg>`
}

// Splash: cream background, smaller "ONA" wordmark centered, terracotta accent dot.
function svgSplash({ width, height }) {
  const fontSize = Math.round(Math.min(width, height) * 0.18)
  const dotSize = Math.round(fontSize * 0.18)
  const dotY = height / 2 + fontSize * 0.55
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${CREAM}"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
      font-family="Georgia, 'Times New Roman', serif" font-weight="400" font-size="${fontSize}"
      fill="${INK}" letter-spacing="-0.04em">ONA</text>
    <circle cx="${width / 2}" cy="${dotY}" r="${dotSize}" fill="${TERRACOTTA}"/>
  </svg>`
}

async function writePng(svg, outPath) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath)
  console.log("  →", path.relative(process.cwd(), outPath))
}

// ── Icons ──────────────────────────────────────────────────────────────────
console.log("Icons:")
await writePng(svgIcon({ size: 192, bg: CREAM, fg: INK }), path.join(OUT_ICONS, "icon-192.png"))
await writePng(svgIcon({ size: 512, bg: CREAM, fg: INK }), path.join(OUT_ICONS, "icon-512.png"))
await writePng(svgMaskable({ size: 192 }), path.join(OUT_ICONS, "icon-192-maskable.png"))
await writePng(svgMaskable({ size: 512 }), path.join(OUT_ICONS, "icon-512-maskable.png"))
await writePng(svgMonochrome({ size: 512 }), path.join(OUT_ICONS, "icon-monochrome.png"))
await writePng(svgIcon({ size: 180, bg: CREAM, fg: INK }), path.join(OUT_ICONS, "apple-touch-icon.png"))

// ── Favicon (ICO with embedded 32×32 PNG; browsers handle this fine) ──────
console.log("Favicon:")
const favIco = await sharp(Buffer.from(svgIcon({ size: 32, bg: CREAM, fg: INK })))
  .resize(32, 32)
  .png()
  .toBuffer()
await fs.writeFile(OUT_FAVICON, favIco)
console.log("  →", path.relative(process.cwd(), OUT_FAVICON))

// ── Splash screens (8 device sizes per spec) ───────────────────────────────
console.log("Splash screens:")
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

console.log("\nDone. Replace these placeholder PNGs with your real branded assets when ready.")
