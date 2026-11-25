import fs from 'node:fs'
import path from 'node:path'
import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter'

/**
 * PRO-398: report of the unstable e2e tests ("inestables"): the ones that
 * failed and then passed on the retry (`retries: 1` in CI, Playwright calls
 * that outcome `flaky`). The run stays green, so without this nobody sees them.
 *
 * Writes, for each run (each CI shard):
 * - `playwright-report/flaky.json` and `flaky.md` (inside the uploaded
 *   artifact; empty list / "ninguno" when there were none), and
 * - in GitHub Actions, one `::warning` annotation per test (file, line, title
 *   and the first failure), readable from the API without a token, plus a
 *   table in the job summary.
 *
 * The Taller opens one maintenance task per test listed here (D-036).
 * It must go after the `html` reporter: that one empties the folder on onEnd.
 */

export interface FlakyTest {
  file: string
  line: number
  project: string
  title: string
  attempts: number
  firstError: string
}

export function firstLine(text: string | undefined): string {
  // Strip ANSI colours: the messages come coloured for the terminal.
  const clean = (text ?? '').replace(/\u001b\[[0-9;]*m/g, '')
  return clean.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 300) ?? ''
}

/** GitHub workflow-command escaping (data and property values). */
function escapeData(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}
function escapeProperty(s: string): string {
  return escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')
}

export function toFlakyTest(test: TestCase, repoRoot: string): FlakyTest {
  const failed = test.results.find((r) => r.status !== 'passed' && r.status !== 'skipped')
  return {
    file: path.relative(repoRoot, test.location.file).split(path.sep).join('/'),
    line: test.location.line,
    project: test.parent.project()?.name ?? '',
    title: test.titlePath().slice(3).filter(Boolean).join(' › ') || test.title,
    attempts: test.results.length,
    firstError: firstLine(failed?.error?.message ?? failed?.errors[0]?.message),
  }
}

export function annotation(t: FlakyTest): string {
  const msg = `«${t.title}» falló y pasó al intento ${t.attempts}${t.firstError ? `. Primer fallo: ${t.firstError}` : ''}`
  return `::warning file=${escapeProperty(t.file)},line=${t.line},title=${escapeProperty('E2E inestable')}::${escapeData(msg)}`
}

export function markdown(tests: FlakyTest[]): string {
  if (tests.length === 0) return '## E2E inestables\n\nNinguno: todos los tests pasaron a la primera.\n'
  const rows = tests.map(
    (t) => `| \`${t.file}:${t.line}\` | ${t.title.replace(/\|/g, '\\|')} | ${t.attempts} | ${t.firstError.replace(/\|/g, '\\|')} |`,
  )
  return [
    '## E2E inestables',
    '',
    `${tests.length} test(s) fallaron y pasaron al reintento. Cada uno, una tarea de mantenimiento del Taller.`,
    '',
    '| Test | Título | Intentos | Primer fallo |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

export default class FlakyReporter implements Reporter {
  private suite: Suite | undefined
  private repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd()
  private outputDir = 'playwright-report'

  onBegin(config: FullConfig, suite: Suite): void {
    this.suite = suite
    // Same folder as the html reporter: playwright-report next to the config.
    const webDir = config.configFile ? path.dirname(config.configFile) : process.cwd()
    this.outputDir = path.join(webDir, 'playwright-report')
    if (!process.env.GITHUB_WORKSPACE) this.repoRoot = path.resolve(webDir, '../..')
  }

  onEnd(): void {
    const tests = (this.suite?.allTests() ?? [])
      .filter((t) => t.outcome() === 'flaky')
      .map((t) => toFlakyTest(t, this.repoRoot))

    fs.mkdirSync(this.outputDir, { recursive: true })
    fs.writeFileSync(path.join(this.outputDir, 'flaky.json'), JSON.stringify(tests, null, 2) + '\n')
    fs.writeFileSync(path.join(this.outputDir, 'flaky.md'), markdown(tests))

    if (tests.length > 0) console.log(`\n${tests.length} e2e inestable(s): ${path.join(this.outputDir, 'flaky.md')}`)
    if (process.env.GITHUB_ACTIONS) {
      for (const t of tests) console.log(annotation(t))
      if (process.env.GITHUB_STEP_SUMMARY && tests.length > 0) {
        fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown(tests))
      }
    }
  }

  printsToStdio(): boolean {
    return false
  }
}
