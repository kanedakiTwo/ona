import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// PRO-OF-4: scripts/deploy.sh asks the HQ office for the staging lock through
// scripts/staging-lock.sh before a staging deploy. A fake ssh answers here.
const SCRIPT = resolve(__dirname, '../../../../scripts/staging-lock.sh')
const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function run(answer: string | null) {
  const d = mkdtempSync(join(tmpdir(), 'staging-lock-'))
  dirs.push(d)
  const ssh = join(d, 'ssh')
  writeFileSync(ssh, answer === null ? '#!/bin/sh\nexit 255\n' : `#!/bin/sh\ncat <<'EOF'\n${answer}\nEOF\n`)
  chmodSync(ssh, 0o755)
  return spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: { ...process.env, HQ_LOCK_SSH: ssh } })
}

describe('staging-lock.sh (PRO-OF-4)', () => {
  it('free → goes on (0)', () => {
    expect(run('{"staging":null}').status).toBe(0)
    expect(run('{"staging": null, "sin_oficina": true}').status).toBe(0)
  })

  it('held by the office → refuses with 3 and says until when', () => {
    const r = run('{"staging":{"dueno":"oficina (accion)","hasta":"2026-10-25T19:00:00.000Z"}}')
    expect(r.status).toBe(3)
    expect(r.stderr).toContain('oficina (accion)')
    expect(r.stderr).toContain('2026-10-25T19:00:00.000Z')
  })

  it('held by Miguel (he took it to deploy by hand) → goes on', () => {
    expect(run('{"staging":{"dueno":"miguel","hasta":"2026-10-25T19:00:00.000Z"}}').status).toBe(0)
  })

  it('no answer (no WireGuard, e.g. a cloud routine) → warns and goes on', () => {
    const r = run(null)
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('Could not ask the HQ office')
  })
})
