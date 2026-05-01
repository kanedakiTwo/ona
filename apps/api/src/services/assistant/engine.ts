import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env.js'
import { loadUserContext } from './contextLoader.js'
import { buildSystemPrompt } from './systemPrompt.js'
import { skills, getToolDefinitions } from './skills.js'
import type { AssistantResponse, ChatMessage } from './types.js'

let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    if (!env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured')
    }
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  }
  return client
}

/**
 * Core chat orchestrator. Sends the user message to Claude with tool definitions,
 * handles tool_use responses, and returns the final assistant response.
 */
export async function chat(
  userId: string,
  message: string,
  history: ChatMessage[],
  db: any,
): Promise<AssistantResponse> {
  const anthropic = getClient()

  // 1. Load user context
  const userContext = await loadUserContext(userId, db)

  // 2. Build system prompt
  const systemPrompt = buildSystemPrompt(userContext)

  // 3. Build messages array from history + new message
  const messages: Anthropic.MessageParam[] = history.map(msg => ({
    role: msg.role,
    content: msg.content,
  }))
  messages.push({ role: 'user', content: message })

  // 4. Get tool definitions
  const tools = getToolDefinitions()

  // 5. First API call
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
    tools: tools as any,
  })

  // 6. Check for tool use
  const toolUseBlock = response.content.find(block => block.type === 'tool_use') as
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | undefined

  if (toolUseBlock) {
    // Find the skill
    const skill = skills.find(s => s.name === toolUseBlock.name)

    if (!skill) {
      // Unknown tool — return error text
      return {
        message: 'Ha habido un error interno. Intentalo de nuevo.',
        actionTaken: false,
      }
    }

    // Execute the skill handler
    let skillResult
    try {
      skillResult = await skill.handler(toolUseBlock.input, { userId, db })
    } catch (err: any) {
      console.error(`[assistant] Skill ${skill.name} error:`, err.message)
      skillResult = {
        data: null,
        summary: `Error ejecutando ${skill.name}: ${err.message}`,
        uiHint: 'text' as const,
      }
    }

    // Build tool_result message and make second API call
    const followUpMessages: Anthropic.MessageParam[] = [
      ...messages,
      { role: 'assistant' as const, content: response.content as any },
      {
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: toolUseBlock.id,
            content: skillResult.summary,
          },
        ],
      },
    ]

    const followUp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: followUpMessages,
      tools: tools as any,
    })

    // Extract text from follow-up response
    const followUpText = followUp.content.find(block => block.type === 'text') as
      | { type: 'text'; text: string }
      | undefined

    return {
      message: followUpText?.text ?? skillResult.summary,
      skillUsed: skill.name,
      data: skillResult.data,
      uiHint: skillResult.uiHint,
      actionTaken: true,
    }
  }

  // 7. No tool use — extract text response directly
  const textBlock = response.content.find(block => block.type === 'text') as
    | { type: 'text'; text: string }
    | undefined

  return {
    message: textBlock?.text ?? 'No he podido generar una respuesta.',
    actionTaken: false,
  }
}
