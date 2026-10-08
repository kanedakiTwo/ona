/**
 * Brand rename guard (decision 2026-10-08): users see **Mimoia** (the
 * product) and **Mimo** (the assistant), never the old "ONA" / "Ona". ONA
 * stays only as the internal name (packages, env vars, DB, code symbols,
 * comments, logs).
 *
 * Several Claude sessions write copy in parallel, so besides pinning the
 * assistant's persona and the AI disclosure this scans every string literal
 * and JSX text in the user-facing code for the old name. Comments are ignored
 * (the TypeScript parser drops them), so internal notes can keep saying ONA.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { AI_DISCLOSURE, ASSISTANT_NAME, BRAND_NAME } from '@ona/shared'
import { buildSystemPrompt, type AssistantMode } from '../services/assistant/systemPrompt.js'

const REPO = resolve(__dirname, '../../../..')
const OLD_NAME = /\b(ONA|Ona)\b/

describe('assistant persona', () => {
  const modes: AssistantMode[] = ['text', 'voice', 'onboarding', 'whatsapp']

  it.each(modes)('the %s prompt makes the model Mimo, of Mimoia', (mode) => {
    const prompt = buildSystemPrompt('', mode)
    expect(prompt.startsWith('Eres Mimo, el asistente de Mimoia')).toBe(true)
    expect(prompt).toContain('"Hola, soy Mimo, de Mimoia"')
    // The only mention of the old name is the rule telling it not to use it.
    expect(prompt).not.toMatch(/(soy|asistente de|conocimiento nutricional de|avisos en) (ONA|Ona)\b/)
    expect(prompt.match(/\b(ONA|Ona)\b/g) ?? []).toEqual(['ONA', 'Ona'])
  })

  it('voice onboarding introduces itself as Mimo', () => {
    expect(buildSystemPrompt('', 'onboarding')).toContain('("Hola, soy Mimo, de Mimoia. Voy a hacerte')
  })

  it('the shared names are the decided ones', () => {
    expect(BRAND_NAME).toBe('Mimoia')
    expect(ASSISTANT_NAME).toBe('Mimo')
  })
})

describe('AI disclosure (AI Act art. 50) names Mimo and still says it is an AI', () => {
  it('third-person caption', () => {
    expect(AI_DISCLOSURE).toBe(
      'Mimo es un asistente de inteligencia artificial (IA): puede equivocarse y no sustituye a un profesional sanitario.',
    )
  })
})

/** User-facing code. API: routes, middleware, assistant + WhatsApp copy. */
const SURFACES = [
  'apps/web/src',
  'packages/shared/src',
  'apps/api/src/routes',
  'apps/api/src/middleware',
  'apps/api/src/services/assistant',
  'apps/api/src/services/whatsapp',
  'apps/api/src/services/advisor.ts',
  'apps/api/src/services/stt.ts',
  'apps/api/src/services/notificationScheduler.ts',
]

/**
 * Strings that may say ONA on purpose. Keep each entry justified.
 *  - the wake word: the trained Picovoice model still detects "Hola Ona" until
 *    a "Hola Mimo" model replaces it (specs/voice-mode.md).
 *  - the persona rule / reviewer note that explain the old name to the model.
 */
const ALLOWED: Array<{ file: string; text: RegExp }> = [
  { file: 'apps/web/src/hooks/useWakeWord.ts', text: /^Hola Ona$/ },
  { file: 'apps/api/src/services/assistant/systemPrompt.ts', text: /Nunca te llames ONA ni Ona/ },
  { file: 'apps/api/src/services/whatsapp/reviewer.ts', text: /el asistente se llamaba ONA/ },
]

function filesUnder(rel: string): string[] {
  const abs = join(REPO, rel)
  if (statSync(abs).isFile()) return [abs]
  return readdirSync(abs).flatMap((name) => (name === 'node_modules' ? [] : filesUnder(join(rel, name))))
}

/** Every string literal, template chunk and JSX text in a file (comments excluded). */
function visibleTexts(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      out.push(node.text)
    }
    node.forEachChild(visit)
  }
  visit(src)
  return out
}

describe('no user-facing string says ONA / Ona', () => {
  const files = SURFACES.flatMap(filesUnder).filter((f) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f))

  it('scans the web app, the shared package and the API copy', () => {
    const rels = files.map((f) => relative(REPO, f))
    expect(rels).toContain('apps/web/src/components/shared/DesktopSidebar.tsx')
    expect(rels).toContain('apps/api/src/services/whatsapp/inbound.ts')
    expect(files.length).toBeGreaterThan(150)
  })

  it('finds none outside the allow-list', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = relative(REPO, file)
      for (const text of visibleTexts(file)) {
        if (!OLD_NAME.test(text)) continue
        if (ALLOWED.some((a) => a.file === rel && a.text.test(text))) continue
        offenders.push(`${rel}: ${JSON.stringify(text.trim().slice(0, 120))}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
