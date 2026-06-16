# openWakeWord assets

This folder contains the three ONNX models loaded by the in-browser
wake-word runtime at `apps/web/src/lib/wakeword/openWakeWord.ts`.

| File | Source | Tracked? |
|---|---|---|
| `melspectrogram.onnx` | [openWakeWord v0.5.1 release](https://github.com/dscripka/openWakeWord/releases/tag/v0.5.1) | yes (shared, generic) |
| `embedding_model.onnx` | same release | yes (shared, generic) |
| `hey_jarvis_v0.1.onnx` | same release | yes (used for plumbing verification only) |
| `hola_ona.onnx` | **trained per-deployment** — see [training guide](../../../../../docs/voice-mode-openwakeword-training.md) | not committed |

If `hola_ona.onnx` is absent, the runtime fails on session start; the
client surfaces the error in the voice overlay and falls back to FAB.

## Verifying the plumbing locally

To confirm the inference pipeline works before training the real
"Hola Ona" model, point the runtime at the bundled `hey_jarvis` model:

```ts
// quick local hack in useWakeWord.ts
const OPENWAKEWORD_MODEL = '/wakewords/openwakeword/hey_jarvis_v0.1.onnx'
```

Then say "Hey Jarvis" and watch for `[voice] openWakeWord detected`
in the console.
