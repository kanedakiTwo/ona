export interface SkillDefinition {
  name: string
  description: string // Spanish - Claude reads this to decide when to use the tool
  parameters: Record<string, any> // JSON Schema for Anthropic tool input_schema
  handler: (params: any, ctx: SkillContext) => Promise<SkillResult>
}

export interface SkillContext {
  userId: string
  db: any
}

export interface SkillResult {
  data: any
  summary: string // Natural language for Claude to incorporate
  uiHint?: 'text' | 'menu' | 'recipe' | 'shopping_list' | 'nutrition' | 'confirmation'
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
