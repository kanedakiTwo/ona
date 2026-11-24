# Business Metrics & Cost Ledger · Costes y precios

> Parte de [Business Metrics & Cost Ledger](./metrics.md) (la portada lista todas las partes): el libro de costes (`cost_events`), un solo modelo para cada llamada a Claude y los precios.

## Cost ledger (`cost_events`)

Every paid provider call writes one row — user (nullable), household (user's primary at record time), feature, provider, model, units (tokens / audio tokens / minutes / messages / images / characters), estimated `cost_micros` (micro-euros; `NULL` when the model isn't priced — counted in `unpricedCostEvents`, never dropped). Recording is fire-and-forget: it never slows or fails the user's request; errors are logged.

| Feature | Provider / model | Billed to |
|---|---|---|
| `assistant_chat` (web chat turn, all tool rounds) | Anthropic Opus 5.5 (`ASSISTANT_MODEL` = `CLAUDE_MODEL`, since 2026-10-19, PRO-232; Sonnet 5.5 from 2026-10-12, Haiku 4.5 before) | user |
| `whatsapp_chat` | Anthropic Opus 5.5 (same model as the web chat) | user (WhatsApp turn) |
| `telegram_chat` | Anthropic Opus 5.5 (same model as the web chat) | user (Telegram turn, PRO-313; channel off today) |
| `voice_note_transcription` (WhatsApp voice notes) | The first that works of Groq `GROQ_TRANSCRIBE_MODEL` (`whisper-large-v3-turbo`), OpenAI `OPENAI_TRANSCRIBE_MODEL` (2026-10-25; AiKit `google/gemini-3.8-flash` until PRO-1122; one row per provider called, the row's provider says which transcribed) | user |
| `mimo_voice_transcription` (Mimo's voice in the app, `POST /stt`) | Same chain as `voice_note_transcription` | user |
| `chat_tts` (Mimo's replies read aloud, `POST /tts`; units = characters, priced per 1,000 chars) | ElevenLabs `ELEVENLABS_MODEL` | user |
| `voice_realtime` (**historical**: OpenAI Realtime voice mode, client-reported minutes; retired 2026-10-09, old rows kept) | OpenAI `gpt-realtime*` | user |
| `recipe_extract_photo` (web photo, WhatsApp photo) | Anthropic Opus 5.5 (`CLAUDE_MODEL`) | user |
| `recipe_extract_url` (web URL import, `import_recipe_from_url`) | Anthropic Opus 5.5 (`CLAUDE_MODEL`) | user |
| `ingredient_match` (extraction disambiguation) | Anthropic Opus 5.5 (`CLAUDE_MODEL`) | user |
| `unit_fallback` (odd units → grams/ml) | Anthropic Opus 5.5 (`CLAUDE_MODEL`), effort low | user |
| `usda_translation` (ingredient auto-create) | Anthropic Opus 5.5 (`CLAUDE_MODEL`), effort low | user |
| `ingredient_nutrition_estimate` ("Estimar con Mimoia") | Anthropic Opus 5.5 (`CLAUDE_MODEL`), effort low | user |
| `recipe_image` (house photo: create/import, regenerate image) | AiKit `AIKIT_IMAGE_MODEL` (`gpt-image-2`, PRO-265); OpenAI `OPENAI_IMAGE_MODEL` (`gpt-image-2`, PRO-1149; `gpt-image-1` until 2026-11-13) when AiKit fails. Historical rows: AiKit `imagen-fal` | user (seed script: system) |
| `whatsapp_review` (daily conversation reviewer) | Anthropic Opus 5.5 | system |
| `whatsapp_guided` (PRO-156: the writer of the messages Mimo sends by itself) | Anthropic Opus 5.5 (`CLAUDE_MODEL`), effort low | user (counts against the monthly cap) |
| `whatsapp_template` (Mimoia-initiated template, outside the 24 h window) | Meta `utility_template` | user |
| `whatsapp_service` (each free-form message Mimo sends: replies, and proactive messages inside the 24 h window) | Meta `service_message` | user (`null` for a number not linked yet) |

**One model for every Claude call (PRO-232, D-070, 2026-10-19).** `CLAUDE_MODEL = 'claude-opus-5-5'` in `config/models.ts` is the only model id in `apps/api/src` (besides `config/pricing.ts`); `modelIds.test.ts` fails on any other. The rows above that don't say a model (`whatsapp_review`, `taste_next` / `taste_reason`, `menu_fit`, `shop_quote_parse`, `recipe_image_describe` / `recipe_image_check`, `catalog_import_rewrite`, `onboarding_analysis`, `ficha`) use it too. Opus 5.5 always thinks (thinking counts toward `max_tokens`), takes no `temperature` and no forced `tool_choice`; the short calls that were on Haiku 4.5 run at effort `low` with `max_tokens` + 2 000 (`LOW_EFFORT`, `withThinkingRoom`), and their time limits went up: «Afina tu menú» and the guided WhatsApp texts 8 → 15 s, the menu fit line 8 → 12 s (`TASTE_AI_TIMEOUT_MS`, `GUIDED_TIMEOUT_MS`, `MENU_FIT_TIMEOUT_MS`). TODO(spec): measured latency on Opus 5.5 — `scripts/measureClaudeLatency.ts` and `scripts/replayWhatsAppTurns.ts` (seconds per turn) have not been run yet (no API key in the build environment). Price: $4 / $20 per MTok (`pricing.ts`); with Opus, `ADVISOR_MONTHLY_BUDGET_EUR` covers about half as many Mimo turns as with Sonnet 5.5 (FIN-09).

Attribution: every authed request runs in a per-request context carrying the user, so deep calls (matcher, unit fallback, translator) are billed without threading ids. Multipart routes (photo extraction, `POST /stt`) re-enter it after the upload parser. Each WhatsApp inbound turn runs in its own context that the budget check fills in once the phone resolves to a user. Schedulers and scripts have no context → system.

WhatsApp service messages (since 2026-10-01 Meta bills them): one row per message sent, always. Meta gives each business number 1,000 free service messages a month, so the first 1,000 of the Madrid calendar month are recorded as `units.freeMessages = 1` (0 €) and the 1,001st onwards as `units.messages = 1` (€0.0166). The tier is counted over all `whatsapp_service` rows of the month (Mimoia has one number); if that count can't be read the message is recorded as priced. Neither templates nor service messages count as household activity (they're Mimoia's messages; the user's own inbound message already counts).

Not costs, so not recorded: USDA / BEDCA lookups, YouTube/article fetches.

## Prices

All rates live in `config/pricing.ts` (source + date in comments), in the provider's currency; USD is converted with `ADVISOR_EUR_PER_USD` (the same knob the advisor budget uses, default 0.92). The advisor's € budget prices the assistant's model (`ADVISOR_PRICE_MODEL` in `advisorBudget.ts`, kept in sync with `ASSISTANT_MODEL`) from the same table, so budget and ledger never disagree. Anthropic rates checked against the official page on 2026-10-16: Sonnet 5.5 and Opus 5.5 cache reads are 0.05× input (Sonnet 5.5 reads were recorded at double the real rate until then); Haiku 5.5 ($0.10 / $0.50) is in the table for model comparisons. `COST_PRICE_OVERRIDES` (JSON, e.g. `{"openai/gpt-realtime":{"perMinute":0.15}}`) corrects or adds a price without a code change; malformed values are ignored with a warning.

The `openai/gpt-realtime*` entries stay in the table so historical `voice_realtime` rows keep their price. ElevenLabs is priced per 1,000 characters by model (`elevenlabs/<model>`). Marked UNVERIFIED (estimates, override when known): Realtime voice blended **$0.10 / session-minute** (historical; token rates verified, the per-minute blend is derived), AIKIT Imagen-fal image **$0.04** (historical rows only). Groq Whisper (transcription, checked 2026-10-25 on console.groq.com): `whisper-large-v3-turbo` **$0.04 / hour**, `whisper-large-v3` **$0.111 / hour**, each request billed for 10 s at least (the free plan costs 0; this is what it would cost once outgrown). AiKit `google/gemini-3.8-flash` (transcription reserve): **0.67 / 3.35 per MTok** in / out, derived on 2026-10-25 from the `cost` AiKit returns with each answer (≈ 0.001 for a 10 s note); UNVERIFIED currency, recorded as EUR. AiKit `gpt-image-2` is **€0.0044 a photo**, in euros: what AiKit charges, read off the key's spend counter on 2026-10-19 (D-090); OpenAI `gpt-image-1` medium 1536×1024 **$0.063** (measured 2026-10-08). Meta WhatsApp Spain is verified against Meta's EUR list rates effective 2026-10-01 (checked 2026-10-13): utility template and service message **€0.0166**, marketing **€0.0585**.
