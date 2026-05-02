# Voice Mode

Hands-free voice conversation with the assistant, activated by the wake word "Hola Ona" or by tapping the floating mic anywhere in the authenticated app.

**Status: shipped on master. `OPENAI_API_KEY` with `gpt-realtime` access is wired in production. Wake-word path is gated on `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` + `.ppn` model; while those are missing the floating mic FAB at top-right is the way in.**

## User Capabilities

- Users can opt in to "Modo manos libres" from their profile/settings (off by default)
- Once enabled, when Picovoice is configured the app listens for "Hola Ona" on every authenticated route. When Picovoice isn't configured a small mic FAB appears at top-right so users can still open voice mode by tap
- Saying "Hola Ona" (or tapping the FAB) opens a full-screen voice overlay (animated orb, no text) and starts a real-time spoken conversation with the assistant
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
4. **Idle warning**: after the configured silence timeout (20s default, 120s in cooking mode), the assistant says "Sigo aquí. Di 'Hola Ona' para seguir." and disconnects the Realtime session.
5. **Failure**: any error during connect (mic permission denied, no mic, mic in use, SDP exchange failure, network) is caught, surfaced as readable Spanish text in the overlay, and the overlay auto-closes after ~3.5s so the user can retry.
6. **Reconnect**: the next "Hola Ona" or FAB tap within the cached-context window (30 min) re-opens a session and re-injects the conversation context so the user can pick up where they left off.

## Conversation persistence

- The current spoken turns are mirrored client-side as text (Realtime API streams transcripts) and cached in memory.
- On overlay close (manual or after idle), the turns are appended to the `/advisor` chat history.
- The cached context is dropped when the user explicitly changes topic ("hablemos de otra cosa", "olvida eso") or after a long inactivity (e.g., 30 min).

## Privacy and permissions

- Wake word detection is **on-device only** (WASM). No audio is sent anywhere until the wake word fires and the user has confirmed mic permission.
- The opt-in toggle is explicit and reversible. When off, no audio is captured.
- Mic permission is requested once per browser; the app surfaces a clear banner when it's blocked.
- An "always listening" indicator (small mic dot in the header) is visible whenever wake-word detection is running.

## Constraints

- Wake-word phrase is fixed to "Hola Ona" for v1 (custom phrases are out of scope).
- Wake word is browser-side only — desktop and mobile web. Native iOS/Android wrappers are out of scope for v1.
- A Realtime session is short-lived: max 10 minutes of active conversation per session before forced reconnect (provider limit + cost guard).
- The Realtime model is `gpt-realtime`; voice is one of the OpenAI preset Spanish voices.
- Ephemeral tokens are issued by the backend and scoped to a single session; the OpenAI key never reaches the browser.
- Echo cancellation (`getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`) is mandatory; without it the assistant interrupts itself.
- All voice prompts and TTS are in Spanish (`es-ES`).
- Existing `/assistant/:userId/chat` skills are exposed as Realtime tools; the model calls them via function calling and the result is spoken back.
- Skills that are destructive (`generate_weekly_menu`, `swap_meal`, `create_recipe`) require a verbal confirmation in voice mode before executing.

## Wake-word engine

- **Default**: Picovoice Porcupine (WASM, custom phrase "Hola Ona" trained via Picovoice console). Free tier covers personal/dev use.
- **Fallback**: openWakeWord (open source) if Porcupine pricing or licensing becomes a blocker. Requires training a custom model for "Hola Ona".
- The engine is wrapped behind a small `useWakeWord` hook so swapping providers is local.

## Floating mic FAB (manual entry point)

When voice mode is enabled in the profile but the wake-word engine is not available (no `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` or `.ppn` model not yet shipped), a small floating mic button appears top-right on every authenticated route. Tapping it opens the voice overlay manually. The FAB also stays visible alongside the wake word once Picovoice access is granted, so the user always has a tappable fallback if the wake word misfires. The toggle copy in `/profile` reads *"Escuchando 'Hola Ona'"* when wake-word is live and *"Activo (toca el micro flotante)"* when it isn't.

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
- `apps/web/public/wakewords/hola-ona_es_wasm_v3_0_0.ppn` — wake-word model trained for "Hola Ona"
- `apps/web/public/wakewords/porcupine_params_es.pv` — Spanish acoustic model (Porcupine docs)
