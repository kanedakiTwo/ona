# Voice Mode

Hands-free voice conversation with the assistant, activated by the wake word "Hola Ona" anywhere in the authenticated app.

**Status: planned, not implemented yet.**

## User Capabilities

- Users can opt in to "Modo manos libres" from their profile/settings (off by default)
- Once enabled, the app listens for the wake word "Hola Ona" on every authenticated route
- Saying "Hola Ona" opens a full-screen voice overlay (animated orb, no text) and starts a real-time spoken conversation with the assistant
- Users can speak naturally without pressing any button; the assistant detects when they finish and replies aloud
- Users can interrupt the assistant mid-sentence (barge-in) — the assistant stops and listens
- The assistant can call any existing skill (read today's menu, suggest recipes, swap a meal, generate a list, etc.) mid-conversation, and narrate the result
- Users can close the overlay manually (tap, escape, or saying "cierra"); on close, the spoken turns are persisted into the `/advisor` chat as regular messages
- Users can disable the wake word at any time from a quick toggle in the header or profile

## Cooking mode

When the conversation context is "step-by-step cooking" (a recipe-step skill is active, or the user says e.g. "estoy cocinando" / "guíame paso a paso"), the silence timeout extends from 20s to 90–120s so the user can chop, stir, etc. without losing the session. The `wake-lock` from PWA spec is also requested to keep the screen on.

## Session lifecycle

1. **Idle**: only the wake-word detector runs on-device; no audio leaves the browser.
2. **Wake**: detector fires → overlay opens → backend issues an ephemeral Realtime session token → WebRTC connection to OpenAI Realtime API.
3. **Active**: full-duplex audio. Server VAD detects user turns; barge-in handled natively.
4. **Idle warning**: after the configured silence timeout (20s default, 90–120s in cooking mode), the assistant says "Sigo aquí. Di 'Hola Ona' para seguir." and disconnects the Realtime session.
5. **Reconnect**: the next "Hola Ona" within the same topic re-opens a session and re-injects the cached conversation context so the user can pick up where they left off.

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

- _New_ `apps/web/src/hooks/useWakeWord.ts` — Porcupine WASM wrapper
- _New_ `apps/web/src/hooks/useRealtimeSession.ts` — WebRTC + Realtime API client
- _New_ `apps/web/src/components/voice/VoiceOverlay.tsx` — full-screen orb UI
- _New_ `apps/web/src/components/voice/VoiceProvider.tsx` — app-wide always-listening provider mounted in the authed layout
- _New_ `apps/api/src/routes/realtime.ts` — `POST /realtime/:userId/session` returns ephemeral token + tool schemas
- _New_ `apps/api/src/services/realtime/tools.ts` — adapts existing assistant skills to Realtime tool schemas
- _Modified_ `apps/web/src/hooks/useVoice.ts` — kept for the legacy mic button; voice mode supersedes it
- _Modified_ `apps/web/src/components/advisor/AdvisorChat.tsx` — receives persisted voice-mode turns on overlay close
