import { skills } from '../assistant/skills.js'
import type { SkillContext, SkillResult } from '../assistant/types.js'

export interface RealtimeTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, any>
}

export function getRealtimeTools(): RealtimeTool[] {
  return skills.map(skill => ({
    type: 'function',
    name: skill.name,
    description: skill.description,
    parameters: skill.parameters,
  }))
}

export async function executeTool(
  name: string,
  params: any,
  ctx: SkillContext,
): Promise<SkillResult> {
  const skill = skills.find(s => s.name === name)
  if (!skill) {
    return { data: null, summary: `Herramienta desconocida: ${name}`, uiHint: 'text' }
  }
  return skill.handler(params ?? {}, ctx)
}
