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
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
