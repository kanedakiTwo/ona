import { z } from 'zod'
import { BRAND_NAME } from '../constants/brand.js'

/**
 * Pre-launch waitlist (specs/waitlist.md). Shared so the landing form
 * (apps/web/src/components/waitlist/) and `POST /waitlist` validate the very
 * same shape — the contract test (apps/api/src/tests/waitlist.test.ts) runs
 * `buildWaitlistPayload`'s output through `waitlistSignupSchema`.
 *
 * No health data here, ever: no allergies, conditions or goals. The four
 * questions are about the household and how it plans, not about bodies.
 */

export const WAITLIST_HOUSEHOLD_SIZES = ['1', '2', '3-4', '5+'] as const
export const WAITLIST_PLANNER_ROLES = ['yo', 'otra_persona', 'compartido'] as const
export const WAITLIST_CURRENT_METHODS = ['improviso', 'lista', 'app', 'menu_fijo', 'no_cocino'] as const
export const WAITLIST_PLATFORMS = ['ios', 'android', 'otro'] as const
export const WAITLIST_STATUSES = ['waiting', 'invited', 'joined', 'unsubscribed'] as const

export type WaitlistHouseholdSize = (typeof WAITLIST_HOUSEHOLD_SIZES)[number]
export type WaitlistPlannerRole = (typeof WAITLIST_PLANNER_ROLES)[number]
export type WaitlistCurrentMethod = (typeof WAITLIST_CURRENT_METHODS)[number]
export type WaitlistPlatform = (typeof WAITLIST_PLATFORMS)[number]
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number]

export const WAITLIST_HOUSEHOLD_SIZE_LABELS: Record<WaitlistHouseholdSize, string> = {
  '1': 'Solo yo',
  '2': 'Dos',
  '3-4': '3 o 4',
  '5+': '5 o más',
}

export const WAITLIST_PLANNER_ROLE_LABELS: Record<WaitlistPlannerRole, string> = {
  yo: 'Yo',
  otra_persona: 'Otra persona',
  compartido: 'Lo compartimos',
}

export const WAITLIST_CURRENT_METHOD_LABELS: Record<WaitlistCurrentMethod, string> = {
  improviso: 'Improviso sobre la marcha',
  lista: 'Lista en papel o en notas',
  app: 'Con una app',
  menu_fijo: 'Menú fijo que se repite',
  no_cocino: 'Casi no cocino en casa',
}

export const WAITLIST_PLATFORM_LABELS: Record<WaitlistPlatform, string> = {
  ios: 'iPhone',
  android: 'Android',
  otro: 'Otro',
}

/** Stored with each entry. Bump it whenever the consent text on the form or the privacy section changes. */
export const WAITLIST_CONSENT_VERSION = '2026-10-07'

/**
 * The optional "menú de la semana por email" opt-in is a SEPARATE consent
 * (LSSI art. 21–22, RGPD art. 7): unchecked by default, never bundled with
 * the waitlist consent. Its version is stored only when it is given.
 */
export const WAITLIST_NEWSLETTER_CONSENT_VERSION = '2026-10-07'

// ─── Referral codes ──────────────────────────────────────────────

/** Crockford-style base32, lowercase, without i/l/o/u (no look-alikes, URL-safe). */
export const REFERRAL_CODE_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
export const REFERRAL_CODE_LENGTH = 8
export const REFERRAL_CODE_RE = /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/

/** Lowercased code when it is well-formed, else null (a broken `?invita=` never blocks a signup). */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.trim().toLowerCase()
  return REFERRAL_CODE_RE.test(code) ? code : null
}

// ─── Attribution (?ref=, ?utm_*, ?invita=) ───────────────────────

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

/** `?ref=` as a short slug (menu, receta, lista…); anything else falls back to null. */
export function normalizeSource(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  return /^[a-z0-9_-]{1,32}$/.test(s) ? s : null
}

function cleanAttributionText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(CONTROL_CHARS, '').trim().slice(0, max)
  return t || null
}

export interface WaitlistAttribution {
  /** `?ref=` slug, 'invita' when only `?invita=` came, else 'directo'. */
  source: string
  referredByCode: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
}

interface ParamReader {
  get(name: string): string | null
}

/** Read the landing URL's attribution params (pass `new URLSearchParams(location.search)`). */
export function readWaitlistAttribution(params: ParamReader): WaitlistAttribution {
  const referredByCode = normalizeReferralCode(params.get('invita'))
  return {
    source: normalizeSource(params.get('ref')) ?? (referredByCode ? 'invita' : 'directo'),
    referredByCode,
    utmSource: cleanAttributionText(params.get('utm_source'), 100),
    utmMedium: cleanAttributionText(params.get('utm_medium'), 100),
    utmCampaign: cleanAttributionText(params.get('utm_campaign'), 100),
  }
}

// ─── POST /waitlist ──────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v.replace(CONTROL_CHARS, '') : null))

/** Attribution must never fail a signup: bad values are cleaned or dropped, not rejected. */
const attributionText = (max: number) => z.unknown().transform((v) => cleanAttributionText(v, max))

export const waitlistSignupSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email('Ese email no parece válido.'),
  firstName: optionalText(60),
  householdSize: z.enum(WAITLIST_HOUSEHOLD_SIZES),
  plannerRole: z.enum(WAITLIST_PLANNER_ROLES),
  currentMethod: z.enum(WAITLIST_CURRENT_METHODS),
  platform: z.enum(WAITLIST_PLATFORMS),
  supermarket: optionalText(80),
  wantsWhatsapp: z.boolean().default(false),
  /** Separate marketing consent; absent or false = no newsletter. */
  newsletterOptIn: z.boolean().default(false),
  consent: z.literal(true, { errorMap: () => ({ message: 'Necesitamos tu permiso para apuntarte.' }) }),
  /** Honeypot: hidden from people (off-screen, no tab stop). Anything in it is a bot. */
  website: z.string().max(0).optional(),
  source: z.unknown().transform((v) => normalizeSource(v) ?? 'directo'),
  referredByCode: z.unknown().transform(normalizeReferralCode),
  utmSource: attributionText(100),
  utmMedium: attributionText(100),
  utmCampaign: attributionText(100),
})

export type WaitlistSignup = z.output<typeof waitlistSignupSchema>

export const waitlistUnsubscribeSchema = z.object({
  token: z.string().trim().min(16).max(128),
})

export interface WaitlistSignupResponse {
  code: string
  referralUrl: string
  /** People who signed up with this entry's link (unsubscribed ones don't count). */
  referredCount: number
  /**
   * Only on the request that created the entry. A repeat submission with the
   * same email gets the same referral link but never the opt-out token, so
   * knowing someone's email is not enough to take them off the list.
   */
  unsubscribeToken?: string
}

export type WaitlistStatusResponse = Omit<WaitlistSignupResponse, 'unsubscribeToken'>

// ─── The landing form ────────────────────────────────────────────

export interface WaitlistFormState {
  email: string
  firstName: string
  householdSize: WaitlistHouseholdSize | ''
  plannerRole: WaitlistPlannerRole | ''
  currentMethod: WaitlistCurrentMethod | ''
  platform: WaitlistPlatform | ''
  supermarket: string
  wantsWhatsapp: boolean
  /** "Quiero recibir cada viernes el menú de la semana por email" — optional, starts unchecked. */
  newsletterOptIn: boolean
  consent: boolean
  /** Honeypot. */
  website: string
}

export const EMPTY_WAITLIST_FORM: WaitlistFormState = {
  email: '',
  firstName: '',
  householdSize: '',
  plannerRole: '',
  currentMethod: '',
  platform: '',
  supermarket: '',
  wantsWhatsapp: false,
  newsletterOptIn: false,
  consent: false,
  website: '',
}

/** What the form sends; the server re-validates it with `waitlistSignupSchema`. */
export interface WaitlistSignupPayload {
  email: string
  firstName: string | null
  householdSize: string
  plannerRole: string
  currentMethod: string
  platform: string
  supermarket: string | null
  wantsWhatsapp: boolean
  newsletterOptIn: boolean
  consent: boolean
  website: string
  source: string
  referredByCode: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
}

export function isWaitlistFormComplete(form: WaitlistFormState): boolean {
  return (
    form.email.trim().length > 0 &&
    form.householdSize !== '' &&
    form.plannerRole !== '' &&
    form.currentMethod !== '' &&
    form.platform !== '' &&
    form.consent
  )
}

export function buildWaitlistPayload(form: WaitlistFormState, attribution: WaitlistAttribution): WaitlistSignupPayload {
  return {
    email: form.email.trim(),
    firstName: form.firstName.trim() || null,
    householdSize: form.householdSize,
    plannerRole: form.plannerRole,
    currentMethod: form.currentMethod,
    platform: form.platform,
    supermarket: form.supermarket.trim() || null,
    wantsWhatsapp: form.wantsWhatsapp,
    newsletterOptIn: form.newsletterOptIn,
    consent: form.consent,
    website: form.website,
    source: attribution.source,
    referredByCode: attribution.referredByCode,
    utmSource: attribution.utmSource,
    utmMedium: attribution.utmMedium,
    utmCampaign: attribution.utmCampaign,
  }
}

// ─── Links and share text ────────────────────────────────────────

const stripSlash = (origin: string) => origin.replace(/\/+$/, '')

/** The personal link: the landing with `?invita=<code>`. */
export function waitlistReferralUrl(origin: string, code: string): string {
  return `${stripSlash(origin)}/?invita=${code}`
}

/** The owner's page: "Has invitado a N personas". */
export function waitlistStatusPath(code: string): string {
  return `/lista/${code}`
}

export function waitlistUnsubscribePath(token: string): string {
  return `/lista/baja?t=${encodeURIComponent(token)}`
}

/** What the person sends to their household. Plain, first person, no health claims. */
export function waitlistShareText(referralUrl: string): string {
  return `Me he apuntado a ${BRAND_NAME}: te hace el menú de la semana y la lista de la compra, y te lo manda por WhatsApp. Si te apuntas con mi enlace, entramos antes: ${referralUrl}`
}

export function whatsappShareHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
