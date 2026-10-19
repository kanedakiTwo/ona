/**
 * The Claude model every product call uses (D-070, Miguel 2026-10-18:
 * «mínimo Opus 5.5… para todo»; PRO-232). Changing model is this one line:
 * `modelIds.test.ts` fails if any other `claude-…` id appears in `src/`
 * outside this file, `pricing.ts` and the tests.
 *
 * Opus 5.5 always thinks (adaptive; `thinking: disabled` and a thinking
 * budget are a 400), takes no `temperature` / `top_p` and no forced
 * `tool_choice` (`any` / `tool`). Its default effort is `medium`.
 */
export const CLAUDE_MODEL = 'claude-opus-5-5'

/**
 * Short, latency-bound calls that used to run on Haiku 4.5 without thinking
 * (a unit, a one-line reason, a guided WhatsApp text): low effort keeps the
 * thinking short, and `withThinkingRoom` gives `max_tokens` room for it —
 * thinking counts toward `max_tokens`, so a limit sized for the bare answer
 * would cut it off and the caller would silently fall back.
 */
export const LOW_EFFORT = { output_config: { effort: 'low' as const } }
export const THINKING_ROOM_TOKENS = 2000
export function withThinkingRoom(answerTokens: number): number {
  return answerTokens + THINKING_ROOM_TOKENS
}
