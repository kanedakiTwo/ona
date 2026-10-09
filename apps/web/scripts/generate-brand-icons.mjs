// Brand asset generator — Mimoia imagotipo (A3 "cuchara calada", 2026-10-09).
//
// Reads the spoon path from src/components/brand/Mimoia.tsx (the single
// source of truth) and writes every raster/vector the app and Miguel need:
// PWA icons, apple-touch icon, iOS splashes, a real multi-size favicon.ico,
// an SVG favicon, and the profile photo for Instagram / WhatsApp.
//
// Run from apps/web: node scripts/generate-brand-icons.mjs

import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(__dirname, "..")
const OUT_ICONS = path.join(WEB_ROOT, "public/icons")
const OUT_BRAND = path.join(WEB_ROOT, "public/brand")
const CREAM = "#FAF6EE"
const INK = "#1A1612"
const TERRACOTTA = "#C65D38"

const source = await fs.readFile(path.join(WEB_ROOT, "src/components/brand/Mimoia.tsx"), "utf8")
const SYMBOL = source.match(/MIMOIA_SYMBOL_PATH =\s*"([^"]+)"/)?.[1]
if (!SYMBOL) throw new Error("MIMOIA_SYMBOL_PATH not found in Mimoia.tsx")

await fs.mkdir(OUT_ICONS, { recursive: true })
await fs.mkdir(OUT_BRAND, { recursive: true })

/** The spoon (100×100 box) drawn at `drawSize`, centred at (cx, cy). */
function symbol({ cx, cy, drawSize, fill }) {
  const s = drawSize / 100
  return `<g transform="translate(${cx - drawSize / 2}, ${cy - drawSize / 2}) scale(${s})"><path d="${SYMBOL}" fill="${fill}"/></g>`
}

/**
 * Square icon. `pct` = how much of the side the spoon's box takes:
 *   0.64 standard icons, 0.52 maskable (Android crops to the central 80 %
 *   circle; the spoon runs corner to corner, so it needs extra margin),
 *   0.84 monochrome (no background, alpha only).
 * `radius` rounds the background (favicons); 0 = full bleed (the OS masks it).
 */
function svgIcon({ size, bg, fg, pct, radius = 0 }) {
  const bgRect = bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` : ""
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bgRect}${symbol({ cx: size / 2, cy: size / 2, drawSize: size * pct, fill: fg })}</svg>`
}

/** iOS startup image: cream, terracotta spoon slightly above the optical centre. */
function svgSplash({ width, height }) {
  const drawSize = Math.min(width, height) * 0.26
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${CREAM}"/>${symbol({ cx: width / 2, cy: height * 0.47, drawSize, fill: TERRACOTTA })}</svg>`
}

async function writePng(svg, outPath) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(outPath)
  console.log("  →", path.relative(process.cwd(), outPath))
}

/** A real .ico: header + directory + PNG-compressed entries (Vista+ format). */
function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  images.forEach(({ size, png }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2) // palette
    dir.writeUInt8(0, o + 3) // reserved
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...images.map((im) => im.png)])
}

// ── App icons: cream spoon on terracotta (Mimo's face) ─────────────────────
console.log("Icons:")
const icon = (size, pct) => svgIcon({ size, bg: TERRACOTTA, fg: CREAM, pct })
await writePng(icon(192, 0.64), path.join(OUT_ICONS, "icon-192.png"))
await writePng(icon(512, 0.64), path.join(OUT_ICONS, "icon-512.png"))
await writePng(icon(192, 0.52), path.join(OUT_ICONS, "icon-192-maskable.png"))
await writePng(icon(512, 0.52), path.join(OUT_ICONS, "icon-512-maskable.png"))
await writePng(svgIcon({ size: 512, bg: null, fg: INK, pct: 0.84 }), path.join(OUT_ICONS, "icon-monochrome.png"))
await writePng(icon(180, 0.64), path.join(OUT_ICONS, "apple-touch-icon.png"))

// ── Favicons: rounded terracotta tile; the spoon fills more at 16 px ───────
console.log("Favicon:")
const favicon = (size) =>
  svgIcon({ size, bg: TERRACOTTA, fg: CREAM, pct: size <= 16 ? 0.9 : 0.8, radius: size * 0.22 })
const icoImages = []
for (const size of [16, 32, 48]) {
  icoImages.push({ size, png: await sharp(Buffer.from(favicon(size))).png().toBuffer() })
}
await fs.writeFile(path.join(WEB_ROOT, "public/favicon.ico"), encodeIco(icoImages))
console.log("  → public/favicon.ico (16, 32, 48)")
await fs.writeFile(path.join(WEB_ROOT, "public/icon.svg"), favicon(100) + "\n")
console.log("  → public/icon.svg")

// ── Brand files for profiles (Instagram @conmimoia, WhatsApp) ─────────────
console.log("Brand:")
// Profile photos are cropped to a circle: keep the spoon well inside it.
await writePng(icon(1080, 0.56), path.join(OUT_BRAND, "mimoia-perfil.png"))
await fs.writeFile(
  path.join(OUT_BRAND, "mimoia-simbolo.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="${SYMBOL}" fill="${TERRACOTTA}"/></svg>\n`,
)
console.log("  → public/brand/mimoia-simbolo.svg")

// ── iOS splash screens ──────────────────────────────────────────────────────
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

console.log("\nDone.")
