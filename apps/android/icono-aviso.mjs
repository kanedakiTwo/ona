// The small notification icon of the Android app: the Mimoia spoon (MIMOIA_SYMBOL_PATH of apps/web) in white on
// transparent, as a PNG per density (24 dp; Android only reads its alpha). It must be a bitmap, not a vector: Chrome
// asks the app for this icon as a bitmap (DelegationService), and with a vector drawable the notification shows
// Chrome's icon instead. Writes app/src/main/res/drawable-<density>/ic_aviso.png; androidApp.test.ts checks them.
// Usage: node apps/android/icono-aviso.mjs        (sharp comes from apps/web)
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const sharp = createRequire(new URL('../web/package.json', import.meta.url))('sharp')

/** 24 dp in every density. */
export const DENSIDADES = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 }

const fuente = readFileSync(new URL('../web/src/components/brand/Mimoia.tsx', import.meta.url), 'utf8')
const CUCHARA = /MIMOIA_SYMBOL_PATH =\s*"([^"]+)"/.exec(fuente)?.[1]
if (!CUCHARA) throw new Error('icono-aviso: MIMOIA_SYMBOL_PATH not found in Mimoia.tsx')

// 2 dp of margin on each side (Material's notification icon keyline): the spoon's 100 × 100 box takes 20 of the 24 dp.
const svg = (lado) => {
  const dibujo = (lado * 20) / 24
  const m = (lado - dibujo) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}" viewBox="0 0 ${lado} ${lado}"><g transform="translate(${m} ${m}) scale(${dibujo / 100})"><path d="${CUCHARA}" fill="#FFFFFF"/></g></svg>`
}

for (const [densidad, lado] of Object.entries(DENSIDADES)) {
  const dir = fileURLToPath(new URL(`./app/src/main/res/drawable-${densidad}/`, import.meta.url))
  mkdirSync(dir, { recursive: true })
  await sharp(Buffer.from(svg(lado))).ensureAlpha().png({ compressionLevel: 9 }).toFile(`${dir}ic_aviso.png`)
}
