import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Load .env from monorepo root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') })

export const env = {
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ona',
  JWT_SECRET: process.env.JWT_SECRET || 'ona-dev-secret',
  PORT: parseInt(process.env.API_PORT || '8000', 10),
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_REALTIME_MODEL: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime',
  // 'coral' is the OpenAI Realtime preset that lands closest to a Castilian
  // accent (vs. 'marin' which leans Latin-American). The system prompt also
  // pushes for Spain Spanish on top — see systemPrompt.ts when mode='voice'.
  OPENAI_REALTIME_VOICE: process.env.OPENAI_REALTIME_VOICE || 'coral',
  REALTIME_DAILY_MINUTES_PER_USER: parseInt(process.env.REALTIME_DAILY_MINUTES_PER_USER || '30', 10),
  USDA_FDC_API_KEY: process.env.USDA_FDC_API_KEY || '',
  /**
   * Comma-separated emails that get bumped to `role='admin'` automatically
   * on every successful login. Whitespace tolerated; case-insensitive.
   * Removing an email here downgrades the next time that user logs in.
   */
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
}
