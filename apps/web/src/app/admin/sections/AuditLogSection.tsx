"use client"

/**
 * AuditLogSection — admin audit log feed.
 *
 * Reverse-chronological feed (50/page) with:
 *   - admin selector (loaded from useAdminUsersList, perPage=100)
 *   - action selector (codes from auditCodes.ts)
 *   - date range (last 14 days default)
 *
 * Each row expands inline to show pretty-printed JSON.
 *
 * Spec: ../../../../specs/admin-audit-log.md
 */

import { useMemo, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react"
import {
  useAdminAuditLog,
  useAdminUsersList,
  type AdminAuditEntry,
} from "@/hooks/useAdmin"
import { ACTION_CODES, actionLabel } from "@/lib/auditCodes"

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function defaultFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 14)
  return isoDateOnly(d)
}

function defaultTo(): string {
  return isoDateOnly(new Date())
}

function startOfDayIso(yyyyMmDd: string): string {
  return new Date(`${yyyyMmDd}T00:00:00.000Z`).toISOString()
}

function endOfDayIso(yyyyMmDd: string): string {
  return new Date(`${yyyyMmDd}T23:59:59.999Z`).toISOString()
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function shortSummary(entry: AdminAuditEntry): string {
  const p = entry.payload as Record<string, unknown> | null
  if (!p) return ""
  // Diff payloads from ingredient.update arrive as { field: { before, after } }.
  if (entry.action === "ingredient.update") {
    const fields = Object.keys(p)
    if (fields.length === 0) return "(sin cambios)"
    return `${fields.length} campo${fields.length === 1 ? "" : "s"}: ${fields.join(", ")}`
  }
  if (entry.action === "ingredient.remap") {
    const before = (p.before as Record<string, unknown> | undefined) ?? {}
    const after = (p.after as Record<string, unknown> | undefined) ?? {}
    return `fdc ${String(before.fdcId ?? "?")} → ${String(after.fdcId ?? "?")}`
  }
  if (entry.action === "user.suspend" || entry.action === "user.unsuspend") {
    const after = (p.after as Record<string, unknown> | undefined) ?? {}
    return after.suspendedAt
      ? `suspendido el ${formatTimestamp(String(after.suspendedAt))}`
      : "reactivado"
  }
  if (entry.action === "user.reset_password.generate") {
    const exp = p.expires_at
    return exp ? `caduca ${formatTimestamp(String(exp))}` : "enlace generado"
  }
  return ""
}

function targetName(entry: AdminAuditEntry): string {
  const p = entry.payload as Record<string, unknown> | null
  if (!p) return entry.targetId ?? ""
  const before = p.before as Record<string, unknown> | undefined
  const after = p.after as Record<string, unknown> | undefined
  const cands: unknown[] = [
    after?.name,
    before?.name,
    after?.username,
    before?.username,
    after?.email,
    before?.email,
  ]
  for (const c of cands) {
    if (typeof c === "string" && c) return c
  }
  return entry.targetId ?? ""
}

export function AuditLogSection() {
  const [adminId, setAdminId] = useState<string>("")
  const [action, setAction] = useState<string>("")
  const [from, setFrom] = useState<string>(defaultFrom())
  const [to, setTo] = useState<string>(defaultTo())
  const [page, setPage] = useState(1)

  const adminsList = useAdminUsersList({ perPage: 100 })

  const filters = useMemo(
    () => ({
      adminId: adminId || undefined,
      action: action || undefined,
      from: from ? startOfDayIso(from) : undefined,
      to: to ? endOfDayIso(to) : undefined,
      page,
      perPage: 50,
    }),
    [adminId, action, from, to, page],
  )

  const log = useAdminAuditLog(filters)

  const totalPages = useMemo(() => {
    if (!log.data) return 1
    return Math.max(1, Math.ceil(log.data.total / log.data.perPage))
  }, [log.data])

  return (
    <div>
      {/* Filter strip */}
      <div className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
              Admin
            </span>
            <select
              value={adminId}
              onChange={(e) => {
                setPage(1)
                setAdminId(e.target.value)
              }}
              className="mt-1 w-full rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-3 py-2 text-[12px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
            >
              <option value="">Todos</option>
              {adminsList.data?.rows
                .filter((u) => u.role === "admin")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} · {u.email}
                  </option>
                ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
              Acción
            </span>
            <select
              value={action}
              onChange={(e) => {
                setPage(1)
                setAction(e.target.value)
              }}
              className="mt-1 w-full rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-3 py-2 text-[12px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
            >
              <option value="">Todas</option>
              {ACTION_CODES.map((c) => (
                <option key={c} value={c}>
                  {actionLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
              Desde
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setPage(1)
                setFrom(e.target.value)
              }}
              className="mt-1 w-full rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-3 py-2 text-[12px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
              Hasta
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setPage(1)
                setTo(e.target.value)
              }}
              className="mt-1 w-full rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-3 py-2 text-[12px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
            />
          </label>
        </div>
      </div>

      {/* Feed */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA]">
        {log.isLoading && (
          <div className="px-4 py-6 text-[12px] italic text-[#7A7066]">
            Cargando entradas…
          </div>
        )}
        {!log.isLoading && log.data && log.data.rows.length === 0 && (
          <div className="px-4 py-8 text-center text-[12px] italic text-[#7A7066]">
            Sin entradas en este rango.
          </div>
        )}
        {!log.isLoading &&
          log.data &&
          log.data.rows.map((row, idx) => (
            <AuditRow key={row.id} entry={row} first={idx === 0} />
          ))}
      </div>

      {/* Pager */}
      {log.data && log.data.total > 0 && (
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[11px] text-[#7A7066]">
            {log.data.total} entrada{log.data.total === 1 ? "" : "s"} ·
            página {log.data.page} de {totalPages}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#DDD6C5] bg-[#FFFEFA] text-[#4A4239] disabled:opacity-30"
              aria-label="Página anterior"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#DDD6C5] bg-[#FFFEFA] text-[#4A4239] disabled:opacity-30"
              aria-label="Página siguiente"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AuditRow({
  entry,
  first,
}: {
  entry: AdminAuditEntry
  first: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const initials = (entry.adminUsername || entry.adminEmail || "?")
    .charAt(0)
    .toUpperCase()
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(entry.payload ?? {}, null, 2)
    } catch {
      return String(entry.payload)
    }
  }, [entry.payload])
  return (
    <div className={first ? "" : "border-t border-[#DDD6C5]"}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#FAF6EE]"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1A1612] font-display text-xs text-[#FAF6EE]">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] font-medium text-[#1A1612] truncate">
              {entry.adminUsername ?? "(admin desconocido)"}
            </span>
            <span className="text-[10px] uppercase tracking-[0.1em] text-[#A39A8E]">
              {formatTimestamp(entry.createdAt)}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2 text-[11px]">
            <span className="rounded-full bg-[#C65D38]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[#C65D38]">
              {actionLabel(entry.action)}
            </span>
            <span className="text-[#4A4239] truncate">{targetName(entry)}</span>
          </div>
          {shortSummary(entry) && (
            <div className="mt-0.5 text-[11px] italic text-[#7A7066]">
              {shortSummary(entry)}
            </div>
          )}
        </div>
        <div className="shrink-0 text-[#A39A8E]">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-[#DDD6C5]/60 bg-[#FAF6EE] px-4 py-3">
          <pre className="overflow-x-auto rounded bg-[#1A1612] p-3 font-mono text-[10px] leading-relaxed text-[#FAF6EE]">
            {pretty}
          </pre>
        </div>
      )}
    </div>
  )
}
