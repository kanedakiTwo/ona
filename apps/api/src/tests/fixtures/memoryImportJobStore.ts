/**
 * In-memory `ImportJobStore` for the background-import tests: same semantics
 * as the Postgres one (outcomes appended in order, `interruptRunning` closes
 * what is still running).
 */
import { randomUUID } from 'node:crypto'
import { INTERRUPTED_ERROR, type ImportJobRow, type ImportJobStore } from '../../services/catalogImportJobs.js'

export function createMemoryImportJobStore(): ImportJobStore & { rows: ImportJobRow[] } {
  const rows: ImportJobRow[] = []
  const find = (id: string) => rows.find((r) => r.id === id)
  return {
    rows,
    async create(input) {
      const row: ImportJobRow = { id: randomUUID(), ...input, status: 'running', done: 0, outcomes: [], error: null, createdAt: new Date(), finishedAt: null }
      rows.push(row)
      return { ...row, outcomes: [] }
    },
    async progress(id, done, outcome) {
      const row = find(id)
      if (!row) return
      row.done = done
      row.outcomes = [...row.outcomes, outcome]
    },
    async finish(id, status, error = null) {
      const row = find(id)
      if (!row) return
      Object.assign(row, { status, error, finishedAt: new Date() })
    },
    async findRunning() {
      return [...rows].reverse().find((r) => r.status === 'running') ?? null
    },
    async list(limit) {
      return [...rows].reverse().slice(0, limit)
    },
    async get(id) {
      return find(id) ?? null
    },
    async interruptRunning() {
      const running = rows.filter((r) => r.status === 'running')
      for (const r of running) Object.assign(r, { status: 'interrupted', error: INTERRUPTED_ERROR, finishedAt: new Date() })
      return running.length
    },
  }
}
