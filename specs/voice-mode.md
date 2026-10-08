# Voice Mode

Hands-free voice conversation with the assistant (Mimo), activated by the wake word or by tapping the floating mic anywhere in the authenticated app.

**Wake phrase after the rename (2026-10-08):** the assistant is now called Mimo, but the wake word is a trained Picovoice model (`hola-ona_es_wasm_v4_0_0.ppn`) that only detects **"Hola Ona"**. Every string that tells the user what to say reads `WAKE_PHRASE` (`apps/web/src/hooks/useWakeWord.ts`, still "Hola Ona") so the UI never promises a phrase the detector can't hear. **Pending (Miguel):** train a **"Hola Mimo"** keyword (Spanish, Porcupine WASM) in console.picovoice.ai and hand over the `.ppn`; then swap `WAKE_PHRASE`, `DEFAULT_KEYWORD_PATH` and the detection label in that file together.

**Status: shipped on master. `OPENAI_API_KEY` with `gpt-realtime` access is wired in production. Wake-word path is gated on `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` + `.ppn` model; while those are missing the floating mic FAB at top-right is the way in.**

## User Capabilities

- Users can opt in to "Modo voz" (master toggle) from their profile/settings (off by default). When enabled, a floating mic FAB appears top-right on every authenticated route as the manual entry point. On the recipe detail (`/recipes/<id>`, below `lg`) it drops to 72 px from the top so it sits under the hero's share/favourite row instead of covering the favourite (PRO-01, `isRecipeDetailPath` in `VoiceProvider.tsx`; e2e `recipe-detail-voice-favorite.spec.ts`)
- When the master toggle is on AND Picovoice is configured, a separate sub-toggle "Escuchar '<WAKE_PHRASE>'" appears below it. The sub-toggle is independently off by default — users opt in explicitly to "always listening" so the master toggle can stay enabled (FAB visible) without the wake-word burning battery / mic
- Master OFF → no FAB, no wake-word, nothing listening
- Master ON + sub OFF → FAB visible, no wake-word (manual entry only)
- Master ON + sub ON + Picovoice configured → FAB visible **and** the app listens for the wake phrase
- Master ON + sub ON + Picovoice not configured → sub-toggle is hidden; the copy under the master toggle ("Tócalo para hablar con Mimo en manos libres") says hands-free activation will come once the wake-word account is approved, without naming a phrase
- Saying the wake phrase (or tapping the FAB) opens a full-screen voice overlay (animated orb, no text) and starts a real-time spoken conversation with the assistant
- Users can speak naturally without pressing any button; the assistant detects when they finish and replies aloud
- Users can interrupt the assistant mid-sentence (barge-in) — the assistant stops and listens
- The assistant can call any existing skill (read today's menu, suggest recipes, swap a meal, generate a list, etc.) mid-conversation, and narrate the result
- Users can close the overlay manually (tap, escape, or saying "cierra"); on close, the spoken turns are persisted into the `/advisor` chat as regular messages
- Users can disable the wake word at any time from the profile toggle
- If the connection fails or drops, the overlay surfaces a typed error (e.g. "Necesito permiso de micrófono.", "El micrófono está siendo usado por otra app.", "SDP exchange 4xx: …") and auto-closes after a short delay so the user isn't trapped on a broken screen

## Cooking mode

When the conversation context is "step-by-step cooking" (a recipe-step skill is active, or the user says e.g. "estoy cocinando" / "guíame paso a paso"), the silence timeout extends from 20s to 90–120s so the user can chop, stir, etc. without losing the session. The `wake-lock` from PWA spec is also requested to keep the screen on.

## Session lifecycle

1. **Idle**: only the wake-word detector runs on-device (when configured); no audio leaves the browser.
2. **Wake**: detector fires (or user taps the FAB) → overlay opens → backend issues an ephemeral Realtime session token → WebRTC connection to OpenAI Realtime API. Each step logs a `[voice] …` line in the browser console for diagnosis.
3. **Active**: full-duplex audio. Server VAD detects user turns; barge-in handled natively.
4. **Idle warning**: after the configured silence timeout (20s default, 120s in cooking mode), the assistant says "Sigo aquí. Di '<WAKE_PHRASE>' para seguir." when the wake word is actually listening (master + sub-toggle on + Picovoice configured), otherwise "Sigo aquí. Toca el micrófono para seguir.", and disconnects the Realtime session.
5. **Failure**: any error during connect (mic permission denied, no mic, mic in use, SDP exchange failure, network) is caught, surfaced as readable Spanish text in the overlay, and the overlay auto-closes after ~3.5s so the user can retry.
6. **Reconnect**: the next wake phrase or FAB tap within the cached-context window (30 min) re-opens a session and re-injects the conversation context so the user can pick up where they left off.

## Conversation persistence

- The current spoken turns are mirrored client-side as text (Realtime API streams transcripts) and cached in memory.
- On overlay close (manual or after idle), the turns are appended to the `/advisor` chat history.
- The cached context is dropped when the user explicitly changes topic ("hablemos de otra cosa", "olvida eso") or after a long inactivity (e.g., 30 min).
- Every turn (user + assistant) is also POSTed fire-and-forget to `POST /realtime/:userId/transcript`, persisting in the `voice_transcripts` table. A client-generated UUID groups turns of the same overlay open under one `sessionId`. The most recent skill name (captured when the model emits a `function_call_arguments.done` event) is attached to the very next assistant turn so analysis can correlate skills with model output. Admins review these conversations from `/admin` → "Voz" — see [Admin Dashboard](./admin-dashboard.md).

## Privacy and permissions

- Wake word detection is **on-device only** (WASM). No audio is sent anywhere until the wake word fires and the user has confirmed mic permission.
- The opt-in toggle is explicit and reversible. When off, no audio is captured.
- Mic permission is requested once per browser; the app surfaces a clear banner when it's blocked.
- An "always listening" indicator (small mic dot in the header) is visible whenever wake-word detection is running.

## Constraints

- Wake-word phrase is fixed per model (`WAKE_PHRASE`, today "Hola Ona" until the "Hola Mimo" model lands; custom phrases are out of scope).
- Wake word is browser-side only — desktop and mobile web. Native iOS/Android wrappers are out of scope for v1.
- A Realtime session is short-lived: max 10 minutes of active conversation per session before forced reconnect (provider limit + cost guard).
- The Realtime model is `gpt-realtime`; voice is one of the OpenAI preset Spanish voices.
- Ephemeral tokens are issued by the backend and scoped to a single session; the OpenAI key never reaches the browser.
- Echo cancellation (`getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`) is mandatory; without it the assistant interrupts itself.
- All voice prompts and TTS are in Spanish (`es-ES`).
- **AI disclosure (EU AI Act art. 50):** the voice overlay footer always reads "Estás hablando con una IA. Habla con normalidad…" (`AI_DISCLOSURE_SHORT` in `@ona/shared`), visible from the moment the overlay opens.
- Existing `/assistant/:userId/chat` skills are exposed as Realtime tools; the model calls them via function calling and the result is spoken back.
- Skills that are destructive (`generate_weekly_menu`, `swap_meal`, `create_recipe`) require a verbal confirmation in voice mode before executing.

## Wake-word engine

- **Default**: Picovoice Porcupine (WASM, custom phrase trained via Picovoice console: today "Hola Ona", to be replaced by "Hola Mimo"). Free tier covers personal/dev use.
- **Fallback**: openWakeWord (open source) if Porcupine pricing or licensing becomes a blocker. Requires training a custom model for the phrase.
- The engine is wrapped behind a small `useWakeWord` hook so swapping providers is local.

## Floating mic FAB (manual entry point)

The FAB is the manual entry point and is shown whenever the master "Modo voz" toggle is ON, regardless of whether the wake-word sub-toggle is on. Tapping it opens the voice overlay. This guarantees there is always a way to enter voice mode by tap, even when the user has wake-word turned off or the Picovoice account is unavailable. The status text under each toggle in `/profile` is:

- Master toggle: *"Activo · botón flotante visible"* when on, *"Desactivado"* when off.
- Wake-word sub-toggle (only rendered when master is on AND `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` is configured): *"Escuchando '<WAKE_PHRASE>'"* when listening, *"Iniciando…"* during model load, the typed `wakeError` if Porcupine fails, or *"Desactivado · activa para abrir el modo voz por voz"* when off.

## Auto-close on error

If the Realtime session enters `error` or `closed` state while the overlay is open, the overlay shows the typed Spanish error briefly (3.5 s for an explicit error, 1.5 s for a silent close) and then auto-dismisses, returning the user to the underlying screen. This avoids trapping the user behind a frozen "Cerrando…" spinner when network or upstream issues prevent a clean disconnect.

## Cost guardrails

- Realtime sessions are charged per audio minute. The 20s silence timeout, 10-minute hard cap, and explicit user opt-in are the main guardrails.
- A daily per-user quota (env-configurable) is enforced in the backend token issuer; when exceeded, the assistant falls back to the existing text+TTS pipeline and informs the user.

## Related specs

- [Advisor](./advisor.md) — conversation history, skills, system prompt, text mode chat
- [Menus](./menus.md) — skills called during cooking mode
- [Recipes](./recipes.md) — recipe-step narration source
- [PWA](./pwa.md) — Wake Lock and install requirements for cooking mode
- [Design System](./design-system.md) — overlay/orb visuals

## Source

- [apps/web/src/hooks/useWakeWord.ts](../apps/web/src/hooks/useWakeWord.ts) — Porcupine WASM wrapper (swap point for openWakeWord)
- [apps/web/src/hooks/useRealtimeSession.ts](../apps/web/src/hooks/useRealtimeSession.ts) — WebRTC + Realtime API client, tool round-trip, single-shot reconnect
- [apps/web/src/components/voice/VoiceOverlay.tsx](../apps/web/src/components/voice/VoiceOverlay.tsx) — full-screen orb UI
- [apps/web/src/components/voice/VoiceProvider.tsx](../apps/web/src/components/voice/VoiceProvider.tsx) — app-wide always-listening provider, silence timer, cooking-mode extension, context cache, top-right indicator
- [apps/web/src/lib/voiceMessages.ts](../apps/web/src/lib/voiceMessages.ts) — bridge from voice mode to AdvisorChat
- [apps/api/src/routes/realtime.ts](../apps/api/src/routes/realtime.ts) — `POST /realtime/:userId/session`, `/tool`, `/usage`
- [apps/api/src/services/realtime/tools.ts](../apps/api/src/services/realtime/tools.ts) — assistant-skills→Realtime-tools adapter and executor
- [apps/api/src/services/realtime/quota.ts](../apps/api/src/services/realtime/quota.ts) — per-user daily minutes guard
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `OPENAI_API_KEY`, `OPENAI_REALTIME_MODEL`, `OPENAI_REALTIME_VOICE`, `REALTIME_DAILY_MINUTES_PER_USER`
- [apps/web/src/components/advisor/AdvisorChat.tsx](../apps/web/src/components/advisor/AdvisorChat.tsx) — drains voice-mode turns into the chat history; hides mic button while voice mode is on
- [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) — opt-in toggle (Capítulo 04)
- [apps/web/src/app/layout.tsx](../apps/web/src/app/layout.tsx) — mounts `VoiceProvider` only on authed routes
- [apps/web/src/hooks/useVoice.ts](../apps/web/src/hooks/useVoice.ts) — legacy Web Speech mic button; superseded by voice mode while it's active

## Required client config

- `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` — from console.picovoice.ai
- `apps/web/public/wakewords/hola-ona_es_wasm_v4_0_0.ppn` — wake-word model trained for "Hola Ona" (Porcupine WASM v4); to be replaced by a "Hola Mimo" model (see top)
- `apps/web/public/wakewords/porcupine_params_es.pv` — Spanish acoustic model (downloaded from `Picovoice/porcupine` repo)
