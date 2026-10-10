import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { resolveJwtSecret } from './jwtSecret.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Load .env from monorepo root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

export const env = {
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ona',
  /** Fails the boot on a deployed API when missing or < 32 chars (jwtSecret.ts). */
  JWT_SECRET: resolveJwtSecret(),
  /**
   * JWT lifetime, passed straight to `jwt.sign({ expiresIn })`. Accepts the
   * `jsonwebtoken` vercel/ms format (e.g. `'90d'`, `'12h'`). Default is long
   * but finite ("mucho pero no infinito") so a leaked token eventually dies
   * without forcing users to re-login weekly. Tokens issued before this was
   * added never expire — they age out as users naturally re-login.
   */
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '90d',
  PORT: parseInt(process.env.API_PORT || '8000', 10),
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  /**
   * Mimo's voice (D-023): replies read aloud in the companion, instead of the
   * browser's built-in robotic one. Off unless the key and at least one voice
   * are set: then the web falls back to the browser voice. ELEVENLABS_VOICES
   * is "Name:voiceId,Name:voiceId" (first = default). Library voices need a
   * paid ElevenLabs plan. See services/tts.ts.
   */
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
  ELEVENLABS_VOICES: process.env.ELEVENLABS_VOICES || '',
  ELEVENLABS_MODEL: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  USDA_FDC_API_KEY: process.env.USDA_FDC_API_KEY || '',
  /**
   * Comma-separated emails that get bumped to `role='admin'` automatically
   * on every successful login. Whitespace tolerated; case-insensitive.
   * Removing an email here downgrades the next time that user logs in.
   */
  /**
   * Closed beta (PRO-27). `invite` (default until launch day): `POST /register`
   * only accepts a campaign link, an invited waitlist email, a household
   * invitation or an admin email. `open`: anyone. CI and staging run `open`.
   */
  REGISTRATION_MODE: (process.env.REGISTRATION_MODE === 'open' ? 'open' : 'invite') as 'invite' | 'open',
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  /**
   * AiKit Plus API key (Bearer). Used by the recipe image generator — both
   * the bulk script and the per-user `regenerate-image` endpoint. Without
   * it both code paths return 503.
   */
  AIKIT_API_KEY: process.env.AIKIT_API_KEY || '',
  // Recipe photo generator: 'auto' = AiKit, then OpenAI when AiKit refuses
  // (since 2026-10-08 AiKit answers 403 API_KEY_ROUTE_NOT_ALLOWED to keys);
  // 'aikit' / 'openai' pin one. See services/recipeImageGenerator.ts.
  RECIPE_IMAGE_PROVIDER: (process.env.RECIPE_IMAGE_PROVIDER || 'auto') as 'auto' | 'aikit' | 'openai',
  OPENAI_IMAGE_MODEL: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
  /**
   * Where generated recipe images are written.
   *   - prod (Railway): mount the volume at `/data` and set this to
   *     `/data/images/recipes` so files survive deploys.
   *   - dev: defaults to `apps/web/public/images/recipes`, so seed and
   *     freshly generated images both load via Next.js at `/images/recipes/<slug>.jpg`.
   */
  IMAGE_STORAGE_DIR:
    process.env.IMAGE_STORAGE_DIR ||
    path.resolve(__dirname, '../../../../apps/web/public/images/recipes'),
  /**
   * URL prefix written to `recipes.image_url` for newly generated images.
   * Dev: `/images/recipes` (same-origin, Next.js serves). Prod: set to
   * `${API_PUBLIC_URL}/images/recipes` so the absolute URL points at the
   * API service that mounts the volume.
   */
  IMAGE_PUBLIC_URL_BASE:
    process.env.IMAGE_PUBLIC_URL_BASE || '/images/recipes',
  /** Per-user monthly cap on AI image generations (resets implicitly on month change). */
  IMAGE_GEN_MONTHLY_LIMIT: parseInt(
    process.env.IMAGE_GEN_MONTHLY_LIMIT || '20',
    10,
  ),
  /**
   * Per-user monthly spend cap for the text advisor (the `/assistant/:userId/chat`
   * Claude calls), in euros. Resets implicitly on month change. When a user has
   * already spent at least this much in the current month, the chat endpoint
   * returns 429 `ADVISOR_BUDGET_EXCEEDED` until the month rolls over. Default €5.
   */
  ADVISOR_MONTHLY_BUDGET_EUR: parseFloat(
    process.env.ADVISOR_MONTHLY_BUDGET_EUR || '5',
  ),
  /**
   * Per-user monthly cap on ALL paid AI work (chat, WhatsApp, voice,
   * transcription, recipe imports, nutrition estimates, images), in euros,
   * summed from the cost ledger on the Madrid month. Every route that pays a
   * provider checks it first (middleware/spendCap.ts → 429 SPEND_CAP_EXCEEDED).
   * Admins are exempt. 0 disables the cap. Default €10.
   */
  USER_MONTHLY_SPEND_CAP_EUR: parseFloat(process.env.USER_MONTHLY_SPEND_CAP_EUR || '10'),
  /**
   * EUR per USD used to convert Anthropic's USD list price into the euro budget
   * above. The token rates live in `advisorBudget.ts` (Haiku 4.5 list price);
   * this single knob lets ops re-peg the FX without a code change. Default 0.92.
   */
  ADVISOR_EUR_PER_USD: parseFloat(process.env.ADVISOR_EUR_PER_USD || '0.92'),
  /**
   * Optional JSON merged over the provider price table in `config/pricing.ts`
   * (keys `provider/model`), e.g. `{"openai/gpt-realtime":{"perMinute":0.15}}`.
   * Lets ops correct an UNVERIFIED price without a deploy of new code. The same
   * `ADVISOR_EUR_PER_USD` above converts every USD price in the cost ledger.
   */
  COST_PRICE_OVERRIDES: process.env.COST_PRICE_OVERRIDES || '',
  /**
   * Read-only token for `GET /admin/metrics`, `GET /admin/errors` and
   * `GET /admin/waitlist` (header `x-metrics-token`), so an agent can read
   * business metrics, the error log and the waitlist aggregates without an
   * admin JWT. Grants access to those three endpoints only.
   * Empty → token auth disabled (admin JWT still works).
   */
  METRICS_READ_TOKEN: process.env.METRICS_READ_TOKEN || '',
  /**
   * PR 1B feature flag. When `true`, menu/shopping/favorites reads filter by
   * `household_id` so every member of a shared household sees the same
   * rows. When `false` (default in prod), reads stay user-scoped — same
   * behaviour as pre-PR-1B. Inserts always populate both columns so a
   * flag flip is a no-op for the writer.
   *
   * Default is OFF in prod for safety; dev / test default ON so the new
   * scope is exercised in the test suite.
   */
  SHARED_HOUSEHOLD_SCOPE:
    process.env.SHARED_HOUSEHOLD_SCOPE !== undefined
      ? process.env.SHARED_HOUSEHOLD_SCOPE === 'true'
      : process.env.NODE_ENV !== 'production',

  /**
   * Web Push (VAPID) keys. Generated once with
   * `npx web-push generate-vapid-keys`. The public key is shipped to the
   * browser via `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (web env) so `subscribe()`
   * can sign the subscription. The private key stays here and is used by
   * `web-push.sendNotification` to authenticate dispatches.
   *
   * When EITHER is empty, all push endpoints degrade to a friendly 503
   * ("Push no configurado") so a missing env in dev or staging never
   * crashes the server on startup.
   */
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  /** Subject sent with VAPID — must be a mailto: or https:// URL per RFC 8292. */
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:hola@mimoia.com',

  /**
   * Public origin of the web app, used to build links inside WhatsApp
   * replies ("Ver receta: <WEB_PUBLIC_URL>/recipes/<id>") and the waitlist
   * referral / opt-out links the API returns (specs/waitlist.md). No trailing slash.
   */
  WEB_PUBLIC_URL: (process.env.WEB_PUBLIC_URL || 'https://ona-web-production.up.railway.app').replace(/\/+$/, ''),

  /**
   * WhatsApp Cloud API (Meta). The channel is live only when the first four
   * are set — otherwise the webhook answers 503 and `/whatsapp/status`
   * reports `available: false`. See specs/whatsapp.md.
   *   - ACCESS_TOKEN: permanent System User token (whatsapp_business_messaging).
   *   - PHONE_NUMBER_ID: the sender's Graph id (not the phone number itself).
   *   - APP_SECRET: signs webhook bodies (X-Hub-Signature-256).
   *   - VERIFY_TOKEN: any string; echoed by Meta on the GET handshake.
   *   - DISPLAY_NUMBER: the sender number in digits, for wa.me deep links.
   */
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || '',
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET || '',
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || '',
  WHATSAPP_DISPLAY_NUMBER: (process.env.WHATSAPP_DISPLAY_NUMBER || '').replace(/\D/g, ''),
  /**
   * Comma-separated Mimoia account emails allowed to link WhatsApp. Empty means
   * every user. v1 ships for Miguel's household only (Meta test number
   * caps recipients at 5 anyway).
   */
  WHATSAPP_ALLOWED_EMAILS: (process.env.WHATSAPP_ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  /**
   * Optional approved utility template (one `{{1}}` body variable) used for
   * proactive messages outside Meta's 24 h customer-service window. Without
   * it, proactive messages only go out while the window is open.
   */
  WHATSAPP_TEMPLATE_NAME: process.env.WHATSAPP_TEMPLATE_NAME || '',
  /**
   * Per-kind approved templates, JSON: {"daily_brief":"ona_menu_de_hoy",
   * "alert":"ona_aviso_preparacion",…}. Kinds: daily_brief, weekly_nudge,
   * cooking_reminder, dinner_checkin, shopping_reminder, alert, review.
   * Falls back to WHATSAPP_TEMPLATE_NAME. Each body takes one {{1}}.
   */
  WHATSAPP_TEMPLATES: process.env.WHATSAPP_TEMPLATES || '',
  /**
   * Where a person can reach a human ("HUMANO" on WhatsApp, the help copy).
   * Shown to users as-is. Empty → the copy points to the in-app profile.
   */
  SUPPORT_EMAIL: (process.env.SUPPORT_EMAIL || '').trim(),
  /**
   * Who receives the daily WhatsApp conversation review (reviewer.ts) on
   * WhatsApp. Comma-separated Mimoia emails; empty → ADMIN_EMAILS.
   */
  WHATSAPP_REVIEW_EMAILS: (process.env.WHATSAPP_REVIEW_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  WHATSAPP_TEMPLATE_LANG: process.env.WHATSAPP_TEMPLATE_LANG || 'es',
  WHATSAPP_GRAPH_VERSION: process.env.WHATSAPP_GRAPH_VERSION || 'v26.0',
  /** Overridable so local E2E can point the client at a mock Graph server. */
  WHATSAPP_GRAPH_BASE_URL: (process.env.WHATSAPP_GRAPH_BASE_URL || 'https://graph.facebook.com').replace(/\/+$/, ''),
  /**
   * OpenAI speech-to-text model for WhatsApp voice notes. Full gpt-4o-transcribe
   * (≈$0.006/min): the mini model mis-heard short Spanish notes as Galician.
   */
  OPENAI_TRANSCRIBE_MODEL: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
}
