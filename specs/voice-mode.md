# Voice (Mimo)

Talking to Mimo, the assistant, from the floating companion on any signed-in page. Since decision D-023 (2026-10-09) voice is not a separate mode: spoken and typed turns go to the **same Claude assistant** (`POST /assistant/:userId/chat`), in the same panel, with the same conversation. The panel itself is described in [Advisor](./advisor.md).

**Status: shipped (D-023, 2026-10-09).** Voice is record → transcribe → the same chat → read aloud; there is no realtime voice model. Transcription needs `OPENAI_API_KEY`; the ElevenLabs voice needs `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICES` (set in production and staging since 2026-10-09 with a single voice, Miguel's clone; unset → the browser voice reads replies). Mimo opens only by tapping its floating button: there is no spoken activation phrase (removed by D-032, 2026-10-10).

## User Capabilities

- **Tap to talk.** In the Mimo panel, users tap the mic button, speak, and either stop talking (Mimo notices the silence) or tap the mic again to stop and send. While listening, the bubble shows level bars that follow the voice and the status reads «Te escucho…»; then «Un momento…» (transcribing), «Pensando…», «Hablando… (toca para parar)».
- **Spoken replies.** A spoken turn is sent with `mode: 'voice'`, so Mimo answers briefly, in a form meant to be heard. Spoken turns are always read aloud.
- **Read typed replies aloud.** The toggle «Leer las respuestas en voz alta» (panel header icon, and in the profile) also reads replies to typed messages. Off by default; stored per device (`localStorage mimo.speak`).
- **Stop talking.** «Parar» under the composer, or a new mic tap, cuts Mimo off.
- **«Manos libres».** A toggle in the composer: Mimo starts listening, and after each reply it listens again, so users can cook and talk without touching the screen. The conversation ends quietly (hands-free turns off) when nobody speaks for 8 s — except in cook mode. The status line reads «Manos libres» between turns.
- **Hands-free in cook mode** (PRO-55). The «Mimo, manos libres» pill in `/recipes/[id]/cook` opens Mimo listening in hands-free. There a silence never ends it: Mimo just listens again (nothing is sent to transcribe). It ends on tapping the pill or «Manos libres» again, «Parar» (always shown in the panel while hands-free is on in cook mode), closing the panel, or leaving `/cook`. The mic starts 150 ms after the panel opens; tapping «Parar», turning hands-free off or closing the panel inside that window cancels the start, so the mic never turns on (PRO-79, `lib/pendingListen.ts`). See [Cooking mode](./cooking-mode.md).
- **Choose the voice.** When the API offers several ElevenLabs voices, a «Voz» picker shows in the panel header and «Voz de Mimo» in the profile; picking one plays a short preview («Hola, soy Mimo. Así sueno con esta voz…») and is remembered on the device.
- **Cooking by voice.** In cook mode, «siguiente», «repite», «pon un temporizador de 10 minutos» work typed or spoken; Mimo knows which recipe is open (see [Advisor](./advisor.md) → Page context and [Cooking mode](./cooking-mode.md)).
- **Voice onboarding** (`/onboarding/voz`) runs the same loop with `mode: 'onboarding'` (see [User Memory](./user-memory.md)).

## Profile, chapter 04 «Mimo por voz»

Card «Voz» on `/profile` (`data-testid="profile-mimo-voice"`, with a status line saying whether Mimo reads replies aloud). Copy: «Mimo está en el botón flotante de cualquier pantalla. Toca el micro para hablarle, o activa «Manos libres» para conversar sin tocar nada mientras cocinas.»
- Toggle «Leer las respuestas en voz alta» («Activo · también cuando escribes» / «Solo cuando le hablas»).
- «Voz de Mimo» picker, when there are several voices.
- There is no «Escuchar …» switch: the background listener for an activation phrase was removed (D-032). On start the app deletes its old device setting (`localStorage ona.voice.wake` + `word.enabled`) so nothing lingers.
- The old «Modo voz» master toggle and its green floating mic are gone.

## How a spoken turn works

1. **Record** (`useRecorder`): MediaRecorder + an analyser on the mic stream (echo cancellation, noise suppression, auto gain). Voice = RMS above 0.025. The turn ends ~1.3 s after speech stops; nobody speaking within 8 s → nothing is sent; 30 s hard cap. Format: webm/opus, mp4 or ogg, whichever the browser supports.
2. **Transcribe**: `POST /stt` (auth, 60 requests/min, monthly spend cap; multipart `audio` ≤ 10 MB, `audio/*` only) → OpenAI transcription (`OPENAI_TRANSCRIBE_MODEL`, Spanish prompt about menus and recipes) → `{ text }`. Cost feature `mimo_voice_transcription`. Empty text in hands-free → listen again.
3. **Answer**: the text goes to `POST /assistant/:userId/chat` with `mode: 'voice'` and the page path, like any typed turn (same history, skills, budget).
4. **Speak**: `POST /tts { text, voice }` (ElevenLabs). The API strips Markdown/links/emoji, says abbreviations in full (`spokenUnits`: «10 min» → «10 minutos», «1 cda» → «1 cucharada», «10-15 min» → «de 10 a 15 minutos», «180 °C» → «180 grados», «4,99 €», «%», «p. ej.», «aprox.»; the conjunction in «7 u 8» stays), cuts at ~1.200 characters on a sentence end, streams MP3 and records the characters (`chat_tts`, `elevenlabs/<model>`, per 1,000 chars). Since 2026-10-09 production and staging offer a single voice, Miguel's clone («Miguel»), so no picker shows (the picker only appears with several voices). Off or failing → the browser's built-in Spanish voice (`speechSynthesis`).
5. **Hands-free**: once playback ends, back to step 1. A silent turn (nobody spoke) sends nothing; in cook mode it goes straight back to step 1, elsewhere it ends hands-free.

Browsers without MediaRecorder fall back to the Web Speech API recogniser (`useVoice`); its transcript becomes the same spoken turn.

## Privacy and permissions

- Audio is recorded only after a tap on the mic (or, in «Manos libres», after Mimo's previous reply) and only for one turn; it goes to the API and on to OpenAI for transcription, and is not stored.
- Nothing listens in the background: the mic is only open while Mimo's panel shows «Te escucho…».
- Mic permission is asked by the browser on first use.
- Spoken turns are not saved as transcripts. The `voice_transcripts` table holds only sessions from the old voice mode (before 2026-10-09) and is no longer written; the admin "Voz" tab only shows those.

## Constraints

- No spoken activation phrase (D-032): opening Mimo always takes a tap. Hands-free only runs while the panel is open.
- If the mic is denied or missing, the recording ends without a message and Mimo goes back to idle.
- Outside cook mode, hands-free gives up after 8 s of silence; tap the mic to resume. In cook mode it keeps listening (`handsFreeAfterSilence` in `lib/mimoHandsFree.ts`) until turned off or the user leaves `/cook`; a mic error (no permission, no device) always stops it.
- Without `OPENAI_API_KEY`, `POST /stt` answers 503 `STT_DISABLED`; a transcription error is 502 «No te he entendido. Prueba otra vez.», shown in the panel.
- Library ElevenLabs voices need a paid plan (free → 402, so the browser voice is used).
- No voice-minutes quota: spoken turns cost one transcription + one chat turn (+ TTS characters), all under the monthly € cap (`USER_MONTHLY_SPEND_CAP_EUR`) and the chat budget ([Advisor](./advisor.md) → Cost guardrail).
- All prompts and speech are Spanish (`es-ES`).
- **AI disclosure (EU AI Act art. 50):** the panel caption (`AI_DISCLOSURE`, `data-testid="ai-disclosure"`) is visible before and during every spoken turn.
- **History:** the old full-screen voice mode (until 2026-10-09) left only records: `voice_realtime` rows in the cost ledger and their `openai/gpt-realtime*` prices in `config/pricing.ts`, kept so past costs stay priced. No route, env var or UI of it remains.

## Related specs

- [Advisor](./advisor.md) — the Mimo panel, page context, skills, budget
- [Cooking mode](./cooking-mode.md) — the shell Mimo drives by voice
- [User Memory](./user-memory.md) — voice onboarding
- [WhatsApp](./whatsapp.md) — voice notes use the same transcription service
- [Metrics](./metrics.md) — `mimo_voice_transcription` and `chat_tts` costs
- [Design System](./design-system.md) — `MimoButton` / `MimoPanel`

## Source

- [apps/web/src/components/mimo/MimoProvider.tsx](../apps/web/src/components/mimo/MimoProvider.tsx) — voice loop, hands-free, read-aloud setting
- [apps/web/src/components/mimo/MimoPanel.tsx](../apps/web/src/components/mimo/MimoPanel.tsx) — mic, «Manos libres», voice picker, status line
- [apps/web/src/lib/mimoHandsFree.ts](../apps/web/src/lib/mimoHandsFree.ts) — hands-free rules for cook mode (`handsFreeAfterSilence`, `leavesCookMode`)
- [apps/web/src/lib/pendingListen.ts](../apps/web/src/lib/pendingListen.ts) — the cancellable 150 ms mic start after opening the panel (PRO-79)
- [apps/web/src/hooks/useRecorder.ts](../apps/web/src/hooks/useRecorder.ts) — recording with silence detection
- [apps/web/src/hooks/useVoice.ts](../apps/web/src/hooks/useVoice.ts) — read-aloud (`POST /tts`, browser fallback) and the Web Speech recogniser fallback
- [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) — «Voz» card
- [apps/web/src/app/onboarding/voz/page.tsx](../apps/web/src/app/onboarding/voz/page.tsx) — voice onboarding loop
- [apps/api/src/routes/stt.ts](../apps/api/src/routes/stt.ts), [apps/api/src/services/stt.ts](../apps/api/src/services/stt.ts) — `POST /stt`
- [apps/api/src/routes/tts.ts](../apps/api/src/routes/tts.ts), [apps/api/src/services/tts.ts](../apps/api/src/services/tts.ts) — `GET /tts/voices`, `POST /tts`
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `OPENAI_API_KEY`, `OPENAI_TRANSCRIBE_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICES`, `ELEVENLABS_MODEL`
- Tests: `apps/api/src/tests/spendCap.test.ts` (stt/tts gated), `mimoHandsFreeCook.test.ts`; e2e `apps/web/e2e/cook-handsfree.spec.ts`, `voice-toggle.spec.ts` (read-aloud switch; no «Escuchar» switch on `/profile`), `chat-voice.spec.ts`, `mimo-companion.spec.ts`
