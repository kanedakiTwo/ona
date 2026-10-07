#!/usr/bin/env node
/**
 * Fail when route smoke tests were skipped unexpectedly.
 *
 * Reads a vitest JSON report (`--reporter=json --outputFile.json=<path>`) and
 * exits 1 if any test was skipped/todo outside the allow-list, or if nothing
 * passed at all. Guards against the failure mode where every smoke test
 * silently skipped in CI for months and the job still reported green.
 *
 * Usage:
 *   node scripts/assert-smoke-ran.mjs <report.json> [--allow-skip <path-substring>]...
 *
 * `--allow-skip` names files whose skips are expected (e.g. smokes gated on an
 * external API key the job doesn't have).
 */
import fs from 'node:fs'

const args = process.argv.slice(2)
const reportPath = args.shift()
if (!reportPath) {
  console.error('usage: assert-smoke-ran.mjs <report.json> [--allow-skip <path-substring>]...')
  process.exit(2)
}
const allow = []
while (args.length > 0) {
  const flag = args.shift()
  const value = args.shift()
  if (flag !== '--allow-skip' || !value) {
    console.error(`unexpected argument: ${flag}`)
    process.exit(2)
  }
  allow.push(value)
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
const unexpected = []
const allowed = []
let passed = 0
for (const file of report.testResults ?? []) {
  for (const t of file.assertionResults ?? []) {
    if (t.status === 'passed') {
      passed++
      continue
    }
    if (t.status === 'failed') continue // vitest already failed the run
    const entry = `${file.name} › ${t.fullName ?? t.title} [${t.status}]`
    if (allow.some((a) => file.name.includes(a))) allowed.push(entry)
    else unexpected.push(entry)
  }
}

console.log(`smoke report: ${passed} passed, ${allowed.length} allowed skips, ${unexpected.length} unexpected skips`)
for (const e of allowed) console.log(`  allowed skip: ${e}`)
if (passed === 0) {
  console.error('No smoke test passed — the suite did not actually run.')
  process.exit(1)
}
if (unexpected.length > 0) {
  console.error('Unexpectedly skipped smoke tests:')
  for (const e of unexpected) console.error(`  ${e}`)
  process.exit(1)
}
