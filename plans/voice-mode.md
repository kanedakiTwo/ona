# Voice Mode Implementation Plan

## Summary

Hands-free voice conversation for ONA. Users say "Hola Ona" anywhere in the authenticated app to open a full-screen voice overlay backed by the OpenAI Realtime API (gpt-realtime over WebRTC). Wake word runs on-device via Picovoice Porcupine WASM. Existing assistant skills are exposed as Realtime tools so the model can read the menu, swap meals, etc. mid-conversation. On overlay close, spoken turns are persisted into the `/advisor` chat. Cooking mode extends the silence timeout. Off by default; opt-in from profile.

Spec: [voice-mode.md](../specs/voice-mode.md). Existing assistant: [advisor.md](../specs/advisor.md).

**Wake-word swap note:** Porcupine is the default. The plan keeps the wake-word implementation behind a single `useWakeWord` hook so swapping to openWakeWord (open-source) only touches that file. If Porcupine free tier or licensing becomes a blocker, retrain a "Hola Ona" model in openWakeWord and replace the hook internals.

## Tasks

- [ ] Add ephemeral session token endpoint on the backend
  - File: `apps/api/src/routes/realtime.ts` (new) — `POST /realtime/:userId/session` (auth required, mirrors `assistant.ts` style)
  - Calls `POST https://api.openai.com/v1/realtime/sessions` server-side with model `gpt-realtime`, voice (Spanish preset), and the system prompt loaded from `services/assistant/systemPrompt.ts`
  - Returns `{ client_secret, expires_at, model, voice, tools }` — `tools` is the JSON-Schema list from the next task
  - Wire the route in `apps/api/src/index.ts` next to the existing assistant route
  - Env: read `OPENAI_API_KEY` (already present); add `OPENAI_REALTIME_MODEL` and `OPENAI_REALTIME_VOICE` with sensible defaults
  + ([spec: Session lifecycle](../specs/voice-mode.md#session-lifecycle), [spec: Constraints](../specs/voice-mode.md#constraints))

- [ ] Build the skill→Realtime-tool adapter
  - File: `apps/api/src/services/realtime/tools.ts` (new)
  - Import the existing skill definitions from `services/assistant/skills.ts` and emit OpenAI Realtime tool schemas (`{ type: "function", name, description, parameters }`)
  - Re-use the same JSON Schemas verbatim — they were already authored for Anthropic tool calling and are compatible
  - Export `getRealtimeTools()` consumed by the session endpoint above
  + Tool *execution* happens client-side via a small fetch to a new `POST /realtime/:userId/tool` endpoint that re-uses the existing skill `handler(params, ctx)` — add this endpoint here too so all Realtime backend code lives in one folder
  + ([spec: Constraints](../specs/voice-mode.md#constraints))

- [ ] Add per-user daily quota guard for Realtime sessions
  - File: `apps/api/src/services/realtime/quota.ts` (new)
  - Track minutes-of-active-session per `userId` per UTC day (in-memory Map for v1; promote to DB later)
  - Block session creation when `REALTIME_DAILY_MINUTES_PER_USER` (default 30) is exceeded; return HTTP 429 with a message the client can surface
  + ([spec: Cost guardrails](../specs/voice-mode.md#cost-guardrails))

- [ ] Add the `useWakeWord` hook (Porcupine WASM)
  - File: `apps/web/src/hooks/useWakeWord.ts` (new)
  - Install: `pnpm --filter @ona/web add @picovoice/porcupine-web @picovoice/web-voice-processor`
  - Loads the "Hola Ona" `.ppn` keyword file from `apps/web/public/wakewords/hola-ona_es_wasm_v3_0_0.ppn` (placeholder — train in Picovoice console and drop here)
  - API: `useWakeWord({ accessKey, onDetected, enabled })` returns `{ isListening, error }`. Auto-starts when `enabled=true` and the user has granted mic permission
  - Loads access key from `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY`
  - Implementation isolated so swapping to openWakeWord only changes this file (see swap note above)
  + ([spec: Wake-word engine](../specs/voice-mode.md#wake-word-engine), [spec: Privacy and permissions](../specs/voice-mode.md#privacy-and-permissions))

- [ ] Add the `useRealtimeSession` hook (WebRTC client)
  - File: `apps/web/src/hooks/useRealtimeSession.ts` (new)
  - Fetches an ephemeral token from `POST /realtime/:userId/session`, opens an `RTCPeerConnection`, attaches the mic track with `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`, plays the remote audio track
  - Opens an SDP exchange against `https://api.openai.com/v1/realtime?model=...` with the ephemeral key as Bearer
  - Datachannel `oai-events`: parses `response.output_item.delta` for streaming transcripts; handles `response.function_call_arguments.done` by POSTing to `/realtime/:userId/tool` and replying with `conversation.item.create` + `response.create`
  - Exposes: `{ status, transcripts, partialUserText, partialAssistantText, sendUserMessage, disconnect, error }`
  - Tracks last-audio-activity timestamp; emits a `silence` event consumed by the overlay for the idle warning
  - Echo cancellation is mandatory (spec); fail loud if unsupported
  + ([spec: Session lifecycle](../specs/voice-mode.md#session-lifecycle), [spec: Constraints](../specs/voice-mode.md#constraints))

- [ ] Build the `VoiceOverlay` component (animated orb UI)
  - File: `apps/web/src/components/voice/VoiceOverlay.tsx` (new)
  - Full-screen overlay (mobile-first 390×844): centered breathing orb that scales with assistant audio amplitude, small caption at the bottom showing the live partial transcript, close button (X), and a subtle status ring (idle / listening / speaking / error)
  - Uses `useRealtimeSession` plus a lightweight Web Audio AnalyserNode on the remote audio track for the amplitude
  - On close: calls `disconnect()` and forwards the conversation transcripts via a callback prop (consumed by the provider)
  - Tap-anywhere-to-interrupt is unnecessary — barge-in is handled natively by the Realtime turn detector
  + ([spec: User Capabilities](../specs/voice-mode.md#user-capabilities), [spec: Design System cross-link](../specs/voice-mode.md#related-specs))

- [ ] Build the `VoiceProvider` (always-listening shell)
  - File: `apps/web/src/components/voice/VoiceProvider.tsx` (new)
  - Mounts `useWakeWord` when `enabled` (read from user preference; see opt-in task)
  - On wake: opens `<VoiceOverlay />` and pauses the wake detector while a session is active
  - Manages the silence timer: 20s default; switches to 90–120s when the active skill is a recipe-step skill (detected from the last tool call name in `useRealtimeSession`) or when the user says "estoy cocinando" (string match on streaming transcripts)
  - On idle timeout: triggers a final TTS via Realtime ("Sigo aquí. Di 'Hola Ona' para seguir.") then disconnects
  - Caches the last conversation context (turns + summary) in a ref; on next wake, sends it as `conversation.item.create` events before `response.create` so the model continues the topic
  - Drops the cache on phrases like "olvida eso" / "hablemos de otra cosa" or after 30 min idle
  + ([spec: Cooking mode](../specs/voice-mode.md#cooking-mode), [spec: Conversation persistence](../specs/voice-mode.md#conversation-persistence))

- [ ] Mount `VoiceProvider` in the authenticated layout
  - File: `apps/web/src/app/layout.tsx` (modify)
  - Wrap the authenticated `<main>` branch (the `!isPublicRoute` branch) with `<VoiceProvider>` so the wake word is only active inside authed routes
  - Public routes (`PUBLIC_ROUTES` array) stay unchanged — no listening on landing/login/etc.
  + ([spec: User Capabilities](../specs/voice-mode.md#user-capabilities))

- [ ] Persist voice-mode turns into the advisor chat
  - File: `apps/web/src/components/advisor/AdvisorChat.tsx` (modify)
  - Read voice-mode turns from a small Zustand store or React context populated by `VoiceProvider` on overlay close, and append them to the in-memory `messages` state when the user opens `/advisor`
  - Files: `apps/web/src/lib/voiceMessages.ts` (new) — tiny store exposing `appendTurns()` / `consume()`
  - When voice mode is active inside `/advisor`, hide the legacy mic button to avoid confusion (the orb takes over)
  + ([spec: Conversation persistence](../specs/voice-mode.md#conversation-persistence))

- [ ] Add the opt-in toggle and always-listening indicator
  - File: `apps/web/src/app/profile/page.tsx` (modify) — new switch "Modo manos libres" with copy explaining wake word and on-device detection
  - Persistence: `localStorage` key `ona.voice.enabled` (boolean) read by `VoiceProvider`. No backend change for v1
  - File: `apps/web/src/components/shared/Navbar.tsx` (modify) — small mic dot in the top-right when wake-word listening is active; tap toggles it off for the session
  - First-run flow: on enabling, request mic permission immediately and surface a clear error if denied
  + ([spec: Privacy and permissions](../specs/voice-mode.md#privacy-and-permissions))

- [ ] Handle error states and edge cases
  - Mic permission denied → toast in Spanish + auto-disable toggle, link to browser settings help
  - Quota exceeded (HTTP 429 from session endpoint) → overlay shows "Has llegado al límite de voz por hoy" and falls back to the existing text+TTS chat
  - Realtime connection drop mid-session → one silent reconnect attempt; if it fails, persist what we have and close the overlay with an error toast
  - iOS Safari: detect lack of `RTCPeerConnection` audio playback support gracefully; when wake-word is unavailable on a browser, hide the toggle entirely
  - Files touched: `useRealtimeSession.ts`, `VoiceOverlay.tsx`, `VoiceProvider.tsx` (no new files)
  + ([spec: Cost guardrails](../specs/voice-mode.md#cost-guardrails))

- [ ] Update specs with any spec drift after implementation
  - File: `specs/voice-mode.md` (modify) — flip "Status: planned" to active, replace the _New_ markers in the Source section with real links once files exist
  - File: `specs/index.md` (modify) — drop "planned, not implemented yet" and update the Source list
  - File: `specs/advisor.md` (modify) — note that the legacy `useVoice` hook is now superseded inside active conversations

- [ ] Verify implementation
  - Backend: `curl -X POST http://localhost:3001/realtime/$USER_ID/session -H "Authorization: Bearer $JWT"` returns a `client_secret` JSON; confirm the OpenAI key never appears in the response
  - Backend: hit `/realtime/$USER_ID/tool` with a fake `get_todays_menu` payload and confirm it executes the existing skill and returns `summary`
  - Backend: trigger the quota by setting `REALTIME_DAILY_MINUTES_PER_USER=0` and confirm 429 with a Spanish error
  - Client: from a Chromium browser, open the app authed, enable the toggle in profile, grant mic permission, say "Hola Ona" and confirm the overlay opens within ~500ms
  - Client: hold a 30s spoken conversation and confirm latency feels sub-second; interrupt the assistant mid-reply and confirm it stops and listens
  - Client: ask "qué toca cocinar hoy" and confirm `get_todays_menu` is executed and the response is spoken back
  - Client: stay silent 20s and confirm the disconnect TTS message plays and the overlay closes; say "Hola Ona" again and confirm the assistant continues the topic
  - Client: trigger cooking mode (ask for a recipe and say "guíame paso a paso"), stay silent 60s and confirm the session is still active
  - Client: close the overlay and open `/advisor`; confirm the spoken turns appear as messages in the chat
  - Mobile: open Chrome devtools at 390×844 and repeat the wake → conversation → close flow; confirm the orb fits, the close button is reachable, and the bottom tab bar is hidden while the overlay is open
  - Privacy: with the toggle off, confirm the mic indicator never lights up and no audio is captured
  - iOS Safari (best-effort): confirm the toggle is hidden if Web Speech / Porcupine WASM cannot run, with no console errors
