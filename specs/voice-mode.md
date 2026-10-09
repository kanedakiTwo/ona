# Voice (Mimo)

Talking to Mimo, the assistant, from the floating companion on any signed-in page. Since decision D-023 (2026-10-09) voice is not a separate mode: spoken and typed turns go to the **same Claude assistant** (`POST /assistant/:userId/chat`), in the same panel, with the same conversation. The panel itself is described in [Advisor](./advisor.md).

**Status: shipped (D-023, 2026-10-09).** OpenAI Realtime (the old full-screen "Modo voz" with the orb) is retired. Transcription needs `OPENAI_API_KEY`; the ElevenLabs voice needs `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICES` (only in staging as of 2026-10-09; otherwise the browser voice reads replies). The wake word needs `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` and a trained model.

## User Capabilities

- **Tap to talk.** In the Mimo panel, users tap the mic button, speak, and either stop talking (Mimo notices the silence) or tap the mic again to stop and send. While listening, the bubble shows level bars that follow the voice and the status reads «Te escucho…»; then «Un momento…» (transcribing), «Pensando…», «Hablando… (toca para parar)».
- **Spoken replies.** A spoken turn is sent with `mode: 'voice'`, so Mimo answers briefly, in a form meant to be heard. Spoken turns are always read aloud.
- **Read typed replies aloud.** The toggle «Leer las respuestas en voz alta» (panel header icon, and in the profile) also reads replies to typed messages. Off by default; stored per device (`localStorage mimo.speak`).
- **Stop talking.** «Parar» under the composer, or a new mic tap, cuts Mimo off.
- **«Manos libres».** A toggle in the composer: Mimo starts listening, and after each reply it listens again, so users can cook and talk without touching the screen. The conversation ends quietly (hands-free turns off) when nobody speaks for 8 s. The status line reads «Manos libres» between turns.
- **Choose the voice.** When the API offers several ElevenLabs voices, a «Voz» picker shows in the panel header and «Voz de Mimo» in the profile; picking one plays a short preview («Hola, soy Mimo. Así sueno con esta voz…») and is remembered on the device.
- **Wake word.** With Picovoice configured and «Escuchar «Hola Ona»» on in the profile, saying the phrase opens Mimo already listening, in hands-free mode. A terracotta dot on the floating button shows it is listening. It only listens while Mimo is idle and not already hands-free.
- **Cooking by voice.** In cook mode, «siguiente», «repite», «pon un temporizador de 10 minutos» work typed or spoken; Mimo knows which recipe is open (see [Advisor](./advisor.md) → Page context and [Cooking mode](./cooking-mode.md)).
- **Voice onboarding** (`/onboarding/voz`) runs the same loop with `mode: 'onboarding'` (see [User Memory](./user-memory.md)).

## Profile, chapter 04 «Mimo por voz»

Section `data-testid="profile-mimo-voice"`. Copy: «Mimo está en el botón flotante de cualquier pantalla. Toca el micro para hablarle, o activa «Manos libres» para conversar sin tocar nada mientras cocinas.»
- Toggle «Leer las respuestas en voz alta» («Activo · también cuando escribes» / «Solo cuando le hablas»).
- «Voz de Mimo» picker, when there are several voices.
- Toggle «Escuchar «<WAKE_PHRASE>»» when `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` is set (asks for mic permission when turned on; states «Escuchando…», «Iniciando…», «Desactivado · actívalo para abrir a Mimo sin tocar nada»). Without Picovoice, a note says opening Mimo by voice «llegará en cuanto esté entrenada la palabra de activación».
- The old «Modo voz» master toggle and its green floating mic are gone.

## How a spoken turn works

1. **Record** (`useRecorder`): MediaRecorder + an analyser on the mic stream (echo cancellation, noise suppression, auto gain). Voice = RMS above 0.025. The turn ends ~1.3 s after speech stops; nobody speaking within 8 s → nothing is sent; 30 s hard cap. Format: webm/opus, mp4 or ogg, whichever the browser supports.
2. **Transcribe**: `POST /stt` (auth, 60 requests/min, monthly spend cap; multipart `audio` ≤ 10 MB, `audio/*` only) → OpenAI transcription (`OPENAI_TRANSCRIBE_MODEL`, Spanish prompt about menus and recipes) → `{ text }`. Cost feature `mimo_voice_transcription`. Empty text in hands-free → listen again.
3. **Answer**: the text goes to `POST /assistant/:userId/chat` with `mode: 'voice'` and the page path, like any typed turn (same history, skills, budget).
4. **Speak**: `POST /tts { text, voice }` (ElevenLabs). The API strips Markdown/links/emoji, cuts at ~1.200 characters on a sentence end, streams MP3 and records the characters (`chat_tts`, `elevenlabs/<model>`, per 1,000 chars). Off or failing → the browser's built-in Spanish voice (`speechSynthesis`).
5. **Hands-free**: once playback ends, back to step 1.

Browsers without MediaRecorder fall back to the Web Speech API recogniser (`useVoice`); its transcript becomes the same spoken turn.

## Privacy and permissions

- Audio is recorded only after a tap (or the wake word) and only for one turn; it goes to the API and on to OpenAI for transcription, and is not stored.
- The wake word runs **on-device** (Porcupine WASM); no audio leaves the browser until it fires. Off by default.
- Mic permission is asked by the browser on first use; turning the wake word on asks for it up front.
- Spoken turns are not saved as transcripts. The `voice_transcripts` table (Realtime era) is kept but no longer written; the admin "Voz" tab only shows old sessions.

## Constraints

- Wake word: the trained model (`hola-ona_es_wasm_v4_0_0.ppn`) only detects **"Hola Ona"**, so every string reads `WAKE_PHRASE` (`useWakeWord.ts`, still "Hola Ona"). **Pending (Miguel):** train a **"Hola Mimo"** keyword (Spanish, Porcupine WASM) in console.picovoice.ai; then swap `WAKE_PHRASE`, `DEFAULT_KEYWORD_PATH` and the detection label together.
- Wake word is browser-side only (desktop and mobile web). Native wrappers are out of scope.
- If the mic is denied or missing, the recording ends without a message and Mimo goes back to idle.
- Hands-free gives up after 8 s of silence, which can be short while cooking; tap the mic or say the wake word to resume.
- Without `OPENAI_API_KEY`, `POST /stt` answers 503 `STT_DISABLED`; a transcription error is 502 «No te he entendido. Prueba otra vez.», shown in the panel.
- Library ElevenLabs voices need a paid plan (free → 402, so the browser voice is used).
- No voice-minutes quota: spoken turns cost one transcription + one chat turn (+ TTS characters), all under the monthly € cap (`USER_MONTHLY_SPEND_CAP_EUR`) and the chat budget ([Advisor](./advisor.md) → Cost guardrail).
- All prompts and speech are Spanish (`es-ES`).
- **AI disclosure (EU AI Act art. 50):** the panel caption (`AI_DISCLOSURE`, `data-testid="ai-disclosure"`) is visible before and during every spoken turn.
- **Retired 2026-10-09:** OpenAI Realtime (`/realtime/:userId/session|tool|transcript|usage`), `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_TRANSCRIBE_MODEL`, `OPENAI_REALTIME_VOICE`, `REALTIME_DAILY_MINUTES_PER_USER`, the orb overlay and the floating green mic. Old `voice_realtime` rows stay in the cost ledger and the `openai/gpt-realtime*` prices stay in `config/pricing.ts` for history.

## Wake-word engine

- **Default**: Picovoice Porcupine (WASM, custom phrase trained in the Picovoice console: today "Hola Ona", to be replaced by "Hola Mimo"). Free tier covers personal/dev use.
- **Fallback**: openWakeWord (open source) if Porcupine pricing or licensing becomes a blocker; needs a custom model.
- Wrapped behind `useWakeWord`, so swapping providers is local. The on/off setting is `localStorage ona.voice.wakeword.enabled`.

## Related specs

- [Advisor](./advisor.md) — the Mimo panel, page context, skills, budget
- [Cooking mode](./cooking-mode.md) — the shell Mimo drives by voice
- [User Memory](./user-memory.md) — voice onboarding
- [WhatsApp](./whatsapp.md) — voice notes use the same transcription service
- [Metrics](./metrics.md) — `mimo_voice_transcription` and `chat_tts` costs
- [Design System](./design-system.md) — `MimoButton` / `MimoPanel`

## Source

- [apps/web/src/components/mimo/MimoProvider.tsx](../apps/web/src/components/mimo/MimoProvider.tsx) — voice loop, hands-free, read-aloud setting, wake word
- [apps/web/src/components/mimo/MimoPanel.tsx](../apps/web/src/components/mimo/MimoPanel.tsx) — mic, «Manos libres», voice picker, status line
- [apps/web/src/hooks/useRecorder.ts](../apps/web/src/hooks/useRecorder.ts) — recording with silence detection
- [apps/web/src/hooks/useVoice.ts](../apps/web/src/hooks/useVoice.ts) — read-aloud (`POST /tts`, browser fallback) and the Web Speech recogniser fallback
- [apps/web/src/hooks/useWakeWord.ts](../apps/web/src/hooks/useWakeWord.ts) — Porcupine WASM wrapper, `WAKE_PHRASE`
- [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) — chapter 04 «Mimo por voz»
- [apps/web/src/app/onboarding/voz/page.tsx](../apps/web/src/app/onboarding/voz/page.tsx) — voice onboarding loop
- [apps/api/src/routes/stt.ts](../apps/api/src/routes/stt.ts), [apps/api/src/services/stt.ts](../apps/api/src/services/stt.ts) — `POST /stt`
- [apps/api/src/routes/tts.ts](../apps/api/src/routes/tts.ts), [apps/api/src/services/tts.ts](../apps/api/src/services/tts.ts) — `GET /tts/voices`, `POST /tts`
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `OPENAI_API_KEY`, `OPENAI_TRANSCRIBE_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICES`, `ELEVENLABS_MODEL`
- Tests: `apps/api/src/tests/spendCap.test.ts` (stt/tts gated); e2e `apps/web/e2e/voice-toggle.spec.ts`, `chat-voice.spec.ts`, `mimo-companion.spec.ts`

## Required client config

- `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` — from console.picovoice.ai
- `apps/web/public/wakewords/hola-ona_es_wasm_v4_0_0.ppn` — wake-word model for "Hola Ona" (Porcupine WASM v4); to be replaced by a "Hola Mimo" model
- `apps/web/public/wakewords/porcupine_params_es.pv` — Spanish acoustic model (from the `Picovoice/porcupine` repo)
