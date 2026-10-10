/**
 * Brand rename guard (decisions D-012 / D-017, rename 2026-10-08; prose sweep
 * 2026-10-10): the product is **Mimoia** and its assistant is **Mimo**. The
 * old brand name must not appear in anything a person or an agent reads: UI
 * copy, prompts, logs, code comments and the living docs (CLAUDE.md, specs,
 * plans, docs). It survives only in technical identifiers that would break if
 * renamed — lowercase `ona` (`@ona/shared`, `ona-api`, `/recipes-ona`,
 * `ona_aviso`…) and constants such as `ONA_PRINCIPLES` — none of which match
 * the case-sensitive whole-word pattern below.
 *
 * Several Claude sessions write in this repo in parallel, so besides pinning
 * the assistant's persona and the AI disclosure this scans the raw text of
 * every source and doc file (comments included) for the old name.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
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
    expect(prompt).not.toMatch(OLD_NAME)
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

/** Code and living docs, relative to the repo root. */
const ROOTS = ['apps', 'packages', 'specs', 'plans', 'docs', 'scripts', '.github', 'CLAUDE.md', '.env.example']

/** Never scanned: build output, deps, and records that are history by design. */
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.turbo', 'coverage', 'test-results', 'playwright-report'])
const SKIP_PATHS = [
  'apps/api/src/db/migrations', // applied migrations are immutable
  'docs/research', // research reports quote what was said at the time
  'docs/superpowers', // dated design records
]
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.md', '.json', '.sh', '.yml', '.yaml', '.html', '.txt', '.sql'])

/**
 * Lines that may say the old name on purpose. Keep each entry justified.
 *  - the wake phrase: the trained Picovoice model still detects it until a
 *    "Hola Mimo" model replaces it (MIG-08, specs/voice-mode.md).
 *  - tests: the pattern that forbids the old name, and the pre-rename
 *    WhatsApp link message the linker still accepts.
 */
const ALLOWED_ANYWHERE = [/Hola Ona/]
const ALLOWED_IN_TESTS = [/\(ONA\|Ona\)/, /Vincular ONA: /]
const isTest = (rel: string) => /\.(test|spec)\.tsx?$/.test(rel)

function filesUnder(rel: string): string[] {
  if (SKIP_PATHS.includes(rel)) return []
  const abs = join(REPO, rel)
  if (statSync(abs).isFile()) {
    return TEXT_EXT.has(extname(rel)) || basename(rel) === '.env.example' ? [rel] : []
  }
  return readdirSync(abs).flatMap((name) => (SKIP_DIRS.has(name) ? [] : filesUnder(join(rel, name))))
}

describe('nothing a person or an agent reads says the old brand name', () => {
  const files = ROOTS.flatMap(filesUnder)

  it('scans the code, the prompts and the living docs', () => {
    for (const f of [
      'CLAUDE.md',
      'specs/index.md',
      'apps/web/src/components/shared/DesktopSidebar.tsx',
      'apps/web/worker/index.ts',
      'apps/api/src/services/whatsapp/inbound.ts',
      'apps/api/src/services/ingredientMatcherLLM.ts',
      'packages/shared/src/constants/brand.ts',
    ]) {
      expect(files).toContain(f)
    }
    expect(files.length).toBeGreaterThan(400)
  })

  it('finds none outside the allow-list', () => {
    const offenders: string[] = []
    for (const rel of files) {
      readFileSync(join(REPO, rel), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!OLD_NAME.test(line)) return
          if (ALLOWED_ANYWHERE.some((a) => a.test(line))) return
          if (isTest(rel) && ALLOWED_IN_TESTS.some((a) => a.test(line))) return
          offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`)
        })
    }
    expect(offenders).toEqual([])
  })
})
