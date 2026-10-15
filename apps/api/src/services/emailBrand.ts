import { BRAND_NAME } from '@ona/shared'

/**
 * The brand pieces every Mimoia email is built from (specs/email.md): the
 * newsletter and the transactional emails share the masthead with the logo,
 * the signature and the cream-deep footer band. Tables + inline styles,
 * 600 px column; Gmail falls back to Georgia/Helvetica, Apple Mail shows
 * Fraunces, Cormorant and Inter. Every string goes through `esc`.
 */

// Brand tokens (ona-hq brand/guia, apps/web globals.css @theme).
export const INK = '#1A1612'
export const INK_MID = '#4A4239'
export const MUTED = '#6E655B'
export const CREAM = '#FAF6EE'
export const CREAM_DEEP = '#F2EDE0'
export const PAPER = '#FFFEFA'
export const BORDER = '#DDD6C5'
export const BORDER_SOFT = '#E8E2D3'
export const TERRACOTTA = '#C65D38'
export const TERRACOTTA_DEEP = '#B5432A'
export const FOREST = '#2D6A4F'
export const SERIF = "Fraunces, Georgia, 'Times New Roman', serif"
export const ACCENT = "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
export const SANS = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
const FONTS =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,400;1,500&family=Fraunces:opsz,wght@9..144,400;9..144,650&family=Inter:wght@400;500;600&display=swap'

export const EYEBROW = `margin:0 0 10px;font-family:${SANS};font-size:11px;line-height:1.3;font-weight:500;letter-spacing:0.18em;text-transform:uppercase;`
export const BODY = `font-family:${SANS};font-size:16px;line-height:1.6;color:${INK};`

/** Brand images for the email, served by the web from `apps/web/public/email/`. */
export const EMAIL_LOGO_PATH = '/email/mimoia-logo.png'
export const EMAIL_SYMBOL_PATH = '/email/mimoia-simbolo.png'

export interface BrandAssets {
  logoUrl?: string
  symbolUrl?: string
  homeUrl?: string
}

export function brandAssets(publicUrl: string): BrandAssets {
  const web = publicUrl.replace(/\/+$/, '')
  return { logoUrl: `${web}${EMAIL_LOGO_PATH}`, symbolUrl: `${web}${EMAIL_SYMBOL_PATH}`, homeUrl: `${web}/` }
}

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function paragraphs(text: string, style: string, gap = 14): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 ${gap}px;${style}">${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** Escaped headline with `*word*` in the accent italic, terracotta. */
export function accentHeadline(text: string): string {
  return esc(text).replace(
    /\*([^*]+)\*/g,
    `<em style="font-family:${ACCENT};font-style:italic;font-weight:500;font-size:1.18em;color:${TERRACOTTA};">$1</em>`,
  )
}

/** The headline as plain text (no accent marks). */
export function plainHeadline(text: string): string {
  return text.replace(/\*([^*]+)\*/g, '$1')
}

export function row(inner: string, padding = '0 28px'): string {
  return `<tr><td style="padding:${padding};">${inner}</td></tr>`
}

export function headlineRow(text: string, padding = '34px 28px 0'): string {
  return row(
    `<p style="margin:0;font-family:${SERIF};font-size:36px;line-height:1.08;font-weight:400;letter-spacing:-0.025em;color:${INK};">${accentHeadline(text)}</p>`,
    padding,
  )
}

/** The forest pill button (the email's one call to action). */
export function button(label: string, url: string, padding = '6px 28px 34px'): string {
  return row(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${FOREST};border-radius:999px;"><a href="${esc(url)}" style="display:inline-block;padding:15px 30px;font-family:${SANS};font-size:16px;font-weight:600;color:${CREAM};text-decoration:none;">${esc(label)}</a></td></tr></table>`,
    padding,
  )
}

/** Logo (linked home) + an eyebrow line + an optional second line, over a thin rule. */
export function masthead(assets: BrandAssets, eyebrow?: string, subline?: string): string {
  const logo = assets.logoUrl
    ? `<img src="${esc(assets.logoUrl)}" alt="${esc(BRAND_NAME)}" width="150" style="display:inline-block;width:150px;height:auto;border:0;">`
    : `<span style="font-family:${SERIF};font-size:30px;font-weight:650;letter-spacing:-0.02em;color:${TERRACOTTA};">${esc(BRAND_NAME.toLowerCase())}</span>`
  const linked = assets.homeUrl ? `<a href="${esc(assets.homeUrl)}" style="text-decoration:none;">${logo}</a>` : logo
  const lines =
    eyebrow || subline
      ? `${eyebrow ? `<p style="${EYEBROW}margin:0;color:${MUTED};">${esc(eyebrow)}</p>` : ''}${
          subline ? `<p style="margin:6px 0 0;font-family:${SANS};font-size:13px;line-height:1.4;color:${MUTED};">${esc(subline)}</p>` : ''
        }`
      : ''
  return `<tr><td align="center" style="padding:36px 28px 0;">${linked}</td></tr>
<tr><td align="center" style="padding:${lines ? '14px' : '4px'} 28px 26px;border-bottom:1px solid ${BORDER};">${lines}</td></tr>`
}

export interface Signer {
  name: string
  role?: string
}

/** «Un abrazo,» + the signer's name in the accent italic and their role. */
export function signature(signoff?: string, from?: Signer, padding = '6px 28px 40px'): string {
  if (!signoff && !from) return ''
  return row(
    `${signoff ? paragraphs(signoff, `${BODY}font-size:17px;`, 6) : ''}${
      from
        ? `<p style="margin:6px 0 2px;font-family:${ACCENT};font-style:italic;font-weight:500;font-size:38px;line-height:1;color:${INK};">${esc(from.name)}</p>${
            from.role ? `<p style="${EYEBROW}margin:8px 0 0;color:${MUTED};">${esc(from.role)}</p>` : ''
          }`
        : ''
    }`,
    padding,
  )
}

/** The cream-deep band at the bottom: Mimo's round symbol, small print lines (already HTML), the home link. */
export function footerBand(assets: BrandAssets, linesHtml: string[]): string {
  const small = `margin:0 0 10px;font-family:${SANS};font-size:12px;line-height:1.55;color:${MUTED};`
  const brand = esc(BRAND_NAME)
  const home = assets.homeUrl
    ? `<a href="${esc(assets.homeUrl)}" style="color:${MUTED};text-decoration:none;">${brand} · ${esc(assets.homeUrl.replace(/^https?:\/\//, '').replace(/\/+$/, ''))}</a>`
    : brand
  return `<tr><td align="center" style="background:${CREAM_DEEP};padding:30px 28px 26px;">
${assets.symbolUrl ? `<img src="${esc(assets.symbolUrl)}" alt="" width="36" height="36" style="display:block;width:36px;height:36px;border:0;border-radius:50%;margin:0 auto 14px;">` : ''}
${linesHtml.map((l) => `<p style="${small}">${l}</p>`).join('\n')}
<p style="${small}margin:0;">${home}</p>
</td></tr>`
}

/** The whole document around the rows. */
export function emailDocument(title: string, preheader: string | undefined, rows: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<link href="${FONTS}" rel="stylesheet">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};"><tr><td align="center" style="padding:0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${CREAM};">
${rows}
</table></td></tr></table>
</body></html>`
}

/** Miguel signs the personal emails (constitution §5). */
export const MIGUEL: Signer = { name: 'Miguel', role: `Fundador de ${BRAND_NAME}` }
