export interface SkillDefinition {
  name: string
  description: string // Spanish - Claude reads this to decide when to use the tool
  parameters: Record<string, any> // JSON Schema for Anthropic tool input_schema
  handler: (params: any, ctx: SkillContext) => Promise<SkillResult>
}

export interface SkillContext {
  userId: string
  db: any
  /**
   * The app's own REST API, called as this user (see appApi.ts). Skills built
   * on it get exactly the UI's behaviour and permissions. Tests inject a fake.
   */
  api?: import('./appApi.js').AppApi
  /**
   * Where the conversation happens. On `whatsapp` health data (allergies,
   * intolerances, restrictions, physical data) is never stored (Meta's terms
   * 4.2, LEG-03, PRO-24): the skills point to the web profile instead.
   */
  channel?: import('./systemPrompt.js').AssistantMode
  /** PRO-313: the chat app the `whatsapp` mode runs in (Telegram); only the usage events read it (PRO-1022). */
  surface?: import('./systemPrompt.js').ChatSurface
}

export interface SkillResult {
  data: any
  summary: string // Natural language for Claude to incorporate
  uiHint?:
    | 'text'
    | 'menu'
    | 'recipe'
    | 'shopping_list'
    | 'nutrition'
    | 'confirmation'
    | 'cooking_navigate'
    | 'cooking_timer'
    | 'cooking_step'
}

export interface AssistantResponse {
  message: string
  skillUsed?: string
  data?: any
  uiHint?: string
  actionTaken?: boolean
  /** Every skill run this turn, in order (for logs and the daily review). */
  toolsUsed?: string[]
  /**
   * Signals for the daily review (no longer corrective rounds since
   * 2026-10-12): unverified_claim | truncated | refusal | health_talk (PRO-62).
   */
  corrections?: string[]
  /** What each tool got and returned this turn (history + daily review). */
  toolTrace?: ToolTrace[]
  /** An offer line went at the end of this reply (PRO-262 / PRO-164 invites, PRO-285 leftovers question): no other offer line this turn (PRO-248). */
  offerAdded?: boolean
}

export interface ToolTrace {
  name: string
  /** Tool input as compact JSON, bounded. */
  input: string
  /** What the tool told the model, bounded. */
  summary: string
  error?: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
