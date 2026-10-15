import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import sharp from 'sharp'
import type { MealIcon, WeekImageCell, WeekImageModel, WeekImageRow } from './model.js'

/**
 * The WhatsApp week image (2026-10-15): `WeekImageModel` → JPG, 1080 px wide.
 *
 * Pure JS on the server, no browser: satori lays the page out (flexbox only)
 * and writes an SVG with the text as paths; resvg rasterises it; sharp
 * crops the recipe photos and encodes the JPG. Fonts and icons are bundled
 * in `apps/api/assets/` (Fraunces, Cormorant Garamond and Inter, SIL OFL;
 * Noto Emoji images, Apache-2.0), so nothing is fetched to draw the page —
 * only the recipe photos, which the caller passes in already downloaded.
 *
 * Mirrors the approved prototypes: format A (comida y cena, one dish each,
 * square photo left of the name) and format B (photo on top of each cell,
 * name below, «+ second dish» muted).
 */

const ASSETS = new URL('../../../assets/', import.meta.url)
const asset = (p: string) => readFileSync(fileURLToPath(new URL(p, ASSETS)))

const C = {
  cream: '#FAF6EE',
  paper: '#FFFEFA',
  ink: '#1A1612',
  terracotta: '#C65D38',
  muted: '#6E655B',
  faint: '#A39A8E',
  rule: '#DDD6C5',
  hairline: '#E8E2D3',
  tile: '#F2ECE0',
}

export const WIDTH = 1080
const PAD = 56
const CONTENT = WIDTH - PAD * 2
const GAP = 18

type Fonts = Parameters<typeof satori>[1]['fonts']
let cache: { fonts: Fonts; icons: Record<MealIcon, string>; logo: string } | null = null

const pngUri = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`

function assets() {
  if (cache) return cache
  const font = (name: string, file: string, weight: 400 | 500 | 600 | 700, style: 'normal' | 'italic' = 'normal') =>
    ({ name, data: asset(`fonts/${file}`), weight, style })
  cache = {
    fonts: [
      font('Fraunces Display', 'Fraunces-Display-Regular.ttf', 400),
      font('Fraunces', 'Fraunces-Regular.ttf', 400),
      font('Fraunces', 'Fraunces-SemiBold.ttf', 600),
      font('Cormorant', 'CormorantGaramond-MediumItalic.ttf', 500, 'italic'),
      font('Inter', 'Inter-Regular.ttf', 400),
      font('Inter', 'Inter-SemiBold.ttf', 600),
      font('Inter', 'Inter-Bold.ttf', 700),
    ],
    icons: {
      breakfast: pngUri(asset('week-image/breakfast.png')),
      lunch: pngUri(asset('week-image/lunch.png')),
      snack: pngUri(asset('week-image/snack.png')),
      dinner: pngUri(asset('week-image/dinner.png')),
      plate: pngUri(asset('week-image/plate.png')),
    },
    logo: pngUri(asset('week-image/mimoia-logo.png')),
  }
  return cache
}

// ── A tiny element builder (satori takes React-element-shaped objects) ──
type Style = Record<string, string | number>
type Node = { type: string; props: Record<string, unknown> } | string
const el = (type: string, style: Style, ...children: Node[]): Node => ({
  type,
  props: { style: { display: 'flex', ...style }, children: children.length === 1 ? children[0] : children },
})
const text = (style: Style, s: string): Node => ({ type: 'div', props: { style, children: s } })
const img = (src: string, w: number, h: number, style: Style = {}): Node => ({
  type: 'img',
  props: { src, width: w, height: h, style: { width: w, height: h, ...style } },
})
/** Text cut to `lines` lines with an ellipsis (satori supports line-clamp on block boxes). */
const clamped = (style: Style, s: string, lines: number): Node =>
  text({ display: 'block', lineClamp: lines, ...style }, s)

/** Recipe photo cropped to the box, or null (→ neutral tile). */
type PhotoFor = (recipeId: string | null, w: number, h: number) => string | null

// ── Layout per format ──────────────────────────────────────────
interface Layout {
  dayCol: number
  colW: number
  photoW: number
  photoH: number
  radius: number
}

function layoutFor(model: WeekImageModel): Layout {
  const n = Math.max(1, model.columns.length)
  if (model.format === 'A') {
    const dayCol = 150
    const colW = Math.floor((CONTENT - dayCol - GAP * n) / n)
    return { dayCol, colW, photoW: 150, photoH: 150, radius: 18 }
  }
  const dayCol = 118
  const colW = Math.floor((CONTENT - dayCol - GAP * n) / n)
  const photoH = Math.max(96, Math.min(150, Math.round(colW * 0.45)))
  return { dayCol, colW, photoW: colW, photoH, radius: 16 }
}

function tile(icon: string, w: number, h: number, radius: number): Node {
  const size = Math.round(Math.min(w, h) * 0.38)
  return el(
    'div',
    {
      width: w,
      height: h,
      borderRadius: radius,
      backgroundColor: C.tile,
      border: `1px solid ${C.hairline}`,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    img(icon, size, size, { opacity: 0.85 }),
  )
}

function photoOrTile(photo: string | null, icon: string, L: Layout): Node {
  return photo
    ? img(photo, L.photoW, L.photoH, { borderRadius: L.radius, flexShrink: 0 })
    : tile(icon, L.photoW, L.photoH, L.radius)
}

const dash = (): Node => text({ fontFamily: 'Inter', fontSize: 30, color: C.faint, alignSelf: 'center' }, '—')

function cellA(cell: WeekImageCell, icon: string, L: Layout, photoFor: PhotoFor): Node {
  const dish = cell.dishes[0]
  if (!dish) return el('div', { width: L.colW, alignItems: 'center' }, dash())
  return el(
    'div',
    { width: L.colW, gap: GAP, alignItems: 'center' },
    photoOrTile(photoFor(dish.recipeId, L.photoW, L.photoH), icon, L),
    clamped(
      { width: L.colW - L.photoW - GAP, fontFamily: 'Fraunces', fontSize: 31, lineHeight: 1.12, letterSpacing: -0.3, color: C.ink },
      dish.name,
      3,
    ),
  )
}

function cellB(cell: WeekImageCell, icon: string, L: Layout, photoFor: PhotoFor): Node {
  const [first, second] = cell.dishes
  if (!first) return el('div', { width: L.colW, alignItems: 'center', justifyContent: 'center' }, dash())
  const small = { width: L.colW, fontFamily: 'Inter', fontSize: 22, lineHeight: 1.2, color: C.muted }
  const parts: Node[] = [
    photoOrTile(photoFor(first.recipeId, L.photoW, L.photoH), icon, L),
    clamped({ width: L.colW, fontFamily: 'Fraunces', fontSize: 25, lineHeight: 1.12, letterSpacing: -0.25, color: C.ink }, first.name, 2),
  ]
  if (second) parts.push(clamped(small, `+ ${second.name}`, 2))
  if (cell.more > 0) parts.push(text(small, `+${cell.more} más`))
  return el('div', { width: L.colW, flexDirection: 'column', gap: 8 }, ...parts)
}

function dayLabel(row: WeekImageRow, L: Layout, format: WeekImageModel['format']): Node {
  const parts: Node[] = [
    text({ fontFamily: 'Fraunces', fontWeight: 600, fontSize: format === 'A' ? 34 : 32, lineHeight: 1, color: C.ink }, row.dayShort),
    text({ fontFamily: 'Inter', fontSize: 24, color: C.muted, marginTop: 6 }, row.dateLabel),
  ]
  if (row.isToday) {
    parts.push(
      el(
        'div',
        { marginTop: 10, backgroundColor: C.terracotta, borderRadius: 999, padding: '3px 13px' },
        text({ fontFamily: 'Inter', fontWeight: 700, fontSize: 20, letterSpacing: 2.4, color: '#FFFFFF' }, 'HOY'),
      ),
    )
  }
  return el('div', { width: L.dayCol, flexShrink: 0, flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }, ...parts)
}

function row(model: WeekImageModel, r: WeekImageRow, L: Layout, photoFor: PhotoFor): Node {
  const icons = assets().icons
  let body: Node[]
  if (r.kind === 'skipped') {
    body = [text({ fontFamily: 'Cormorant', fontStyle: 'italic', fontWeight: 500, fontSize: 36, color: C.muted, alignSelf: 'center' }, 'Sin cocinar')]
  } else if (r.kind === 'empty') {
    body = [text({ fontFamily: 'Inter', fontSize: 24, color: C.faint, alignSelf: 'center' }, 'Nada previsto')]
  } else {
    body = r.cells.map((cell, i) => {
      const icon = icons[model.columns[i]?.icon ?? 'plate']
      return model.format === 'A' ? cellA(cell, icon, L, photoFor) : cellB(cell, icon, L, photoFor)
    })
  }
  const style: Style = { gap: GAP, alignItems: 'stretch', padding: '14px 0' }
  if (r.isToday) {
    Object.assign(style, {
      backgroundColor: C.paper,
      border: `2px solid ${C.terracotta}`,
      borderRadius: 22,
      padding: 14,
      margin: '6px -16px',
    })
  } else {
    style.borderBottom = `1px solid ${C.hairline}`
  }
  if (r.isPast) style.opacity = 0.42
  return el('div', style, dayLabel(r, L, model.format), ...body)
}

function header(model: WeekImageModel): Node {
  const { logo } = assets()
  return el(
    'div',
    {
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      borderBottom: `2px solid ${C.rule}`,
      paddingBottom: 28,
      marginBottom: 22,
    },
    el(
      'div',
      { flexDirection: 'column' },
      el(
        'div',
        { alignItems: 'baseline' },
        text({ fontFamily: 'Fraunces Display', fontSize: 76, lineHeight: 0.95, letterSpacing: -1.9, color: C.ink }, 'Tu'),
        text(
          { fontFamily: 'Cormorant', fontStyle: 'italic', fontWeight: 500, fontSize: 87, lineHeight: 0.95, color: C.terracotta, marginLeft: 18 },
          'semana',
        ),
      ),
      text({ fontFamily: 'Inter', fontSize: 26, color: C.muted, marginTop: 12 }, model.subtitle),
    ),
    img(logo, 190, Math.round((190 * 151) / 450)),
  )
}

function columnHeaders(model: WeekImageModel, L: Layout): Node {
  const icons = assets().icons
  return el(
    'div',
    { gap: GAP, marginBottom: 10 },
    el('div', { width: L.dayCol, flexShrink: 0 }),
    ...model.columns.map((c) =>
      el(
        'div',
        { width: L.colW, alignItems: 'center', gap: 10 },
        img(icons[c.icon], 26, 26),
        text({ fontFamily: 'Inter', fontWeight: 600, fontSize: 22, letterSpacing: 3, color: C.muted }, c.label.toUpperCase()),
      ),
    ),
  )
}

function footer(): Node {
  const span = (s: string, bold = false) =>
    text({ whiteSpace: 'pre', ...(bold ? { fontWeight: 600, color: C.ink } : {}) }, s)
  return el(
    'div',
    { justifyContent: 'space-between', alignItems: 'center', marginTop: 26, fontFamily: 'Inter', fontSize: 24, color: C.muted },
    el('div', {}, span('¿Cambio algo? '), span('Díselo a Mimo', true), span(' por aquí')),
    el('div', {}, span('mimoia.com', true), span('/menu')),
  )
}

/** The page as satori elements (exported for tests that only check structure). */
export function weekImageTree(model: WeekImageModel, photoFor: PhotoFor): Node {
  const L = layoutFor(model)
  return el(
    'div',
    // The page is WIDTH wide; the padding goes inside a CONTENT-wide column
    // (satori boxes are content-box, so padding on the root would widen it).
    { width: WIDTH, justifyContent: 'center', backgroundColor: C.cream, fontFamily: 'Inter', color: C.ink },
    el(
      'div',
      { width: CONTENT, flexDirection: 'column', paddingTop: PAD, paddingBottom: 40 },
      header(model),
      ...(model.columns.length > 0 ? [columnHeaders(model, L)] : []),
      ...model.rows.map((r) => row(model, r, L, photoFor)),
      footer(),
    ),
  )
}

/**
 * Crops every photo the page draws to its box once (sharp), as data URIs.
 * `photos` are the downloaded recipe images by recipe id; a missing or
 * unreadable one leaves a neutral tile.
 */
async function croppedPhotos(model: WeekImageModel, photos: Map<string, Buffer>): Promise<PhotoFor> {
  const L = layoutFor(model)
  const out = new Map<string, string>()
  await Promise.all(
    [...photos.entries()].map(async ([id, buf]) => {
      try {
        const jpg = await sharp(buf).resize(L.photoW, L.photoH, { fit: 'cover' }).jpeg({ quality: 88 }).toBuffer()
        out.set(id, `data:image/jpeg;base64,${jpg.toString('base64')}`)
      } catch {
        // Not an image we can read: neutral tile.
      }
    }),
  )
  return (recipeId) => (recipeId ? out.get(recipeId) ?? null : null)
}

/** `model` + downloaded photos → JPG bytes (1080 px wide, quality 85). */
export async function renderWeekImage(model: WeekImageModel, photos: Map<string, Buffer> = new Map()): Promise<Buffer> {
  const photoFor = await croppedPhotos(model, photos)
  const svg = await satori(weekImageTree(model, photoFor) as any, { width: WIDTH, fonts: assets().fonts })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng()
  return sharp(png).flatten({ background: C.cream }).jpeg({ quality: 85, mozjpeg: true }).toBuffer()
}
