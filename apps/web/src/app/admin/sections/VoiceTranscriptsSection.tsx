"use client"

/**
 * VoiceTranscriptsSection — read-only review of voice-mode conversations.
 *
 * Two views toggled by `view` state:
 *   - "sessions" (default): paginated list of voice sessions, one row per
 *     session with summary (turns, span, skills used, user). Click a row to
 *     drill in.
 *   - "session-detail": all turns of one session in chronological order
 *     (oldest → newest). "Volver" button returns to the list.
 *
 * Filters available in the list view: user search (free text vs username/
 * email handled client-side over the rows fetched), date range. Skill
 * filtering happens implicitly: each row shows the set of skills used.
 *
 * Spec: ../../../../specs/admin-dashboard.md (#voz section),
 *       ../../../../specs/voice-mode.md
 */

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  useVoiceTranscriptSessions,
  useVoiceTranscriptTurns,
  type VoiceTranscriptSession,
  type VoiceTranscriptTurn,
} from "@/hooks/useAdmin"
import { Empty } from "./shared"

/* ── helpers ───────────────────────────────────────────────────── */

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
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatSpan(startIso: string, endIso: string): string {
  const start = new Date(startIso).getTime()
  const end = new Date(endIso).getTime()
  const seconds = Math.max(1, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rem = seconds % 60
  if (minutes < 60) return rem ? `${minutes}m ${rem}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const minRem = minutes % 60
  return minRem ? `${hours}h ${minRem}m` : `${hours}h`
}

/* ── Component ─────────────────────────────────────────────────── */

type View =
  | { kind: "sessions" }
  | { kind: "session-detail"; sessionId: string; user: string | null }

export function VoiceTranscriptsSection() {
  const [view, setView] = useState<View>({ kind: "sessions" })

  return view.kind === "sessions" ? (
    <SessionsList onOpen={(s) => setView({ kind: "session-detail", sessionId: s.sessionId, user: s.username ?? s.email ?? null })} />
  ) : (
    <SessionDetail
      sessionId={view.sessionId}
      user={view.user}
      onBack={() => setView({ kind: "sessions" })}
    />
  )
}

/* ── Sessions list ─────────────────────────────────────────────── */

function SessionsList({
  onOpen,
}: {
  onOpen: (s: VoiceTranscriptSession) => void
}) {
  const [from, setFrom] = useState(defaultFrom())
  const [to, setTo] = useState(defaultTo())
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")

  const { data, isLoading, error } = useVoiceTranscriptSessions({
    from: startOfDayIso(from),
    to: endOfDayIso(to),
    page,
    perPage: 50,
  })

  const filteredRows = useMemo(() => {
    if (!data?.rows) return []
    if (!search.trim()) return data.rows
    const q = search.trim().toLowerCase()
    return data.rows.filter(
      (r) =>
        (r.username ?? "").toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        r.sessionId.toLowerCase().includes(q),
    )
  }, [data?.rows, search])

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / (data?.perPage ?? 50)))

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border-soft bg-paper p-4">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] uppercase tracking-[0.15em] text-ink-muted mb-1">
            Usuario
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="username o email"
            className="w-full rounded-lg border border-border bg-cream px-3 py-2 text-[13px]"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-[0.15em] text-ink-muted mb-1">
            Desde
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value)
              setPage(1)
            }}
            className="rounded-lg border border-border bg-cream px-3 py-2 text-[13px]"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-[0.15em] text-ink-muted mb-1">
            Hasta
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value)
              setPage(1)
            }}
            className="rounded-lg border border-border bg-cream px-3 py-2 text-[13px]"
          />
        </div>
      </div>

      {/* List */}
      {isLoading && <Empty>Cargando sesiones…</Empty>}
      {error && <Empty>Error al cargar las sesiones.</Empty>}
      {!isLoading && !error && filteredRows.length === 0 && (
        <Empty>No hay sesiones que coincidan con el filtro.</Empty>
      )}

      {filteredRows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-border-soft bg-paper">
          {filteredRows.map((s, i) => (
            <button
              key={s.sessionId}
              onClick={() => onOpen(s)}
              className={`flex w-full items-start gap-4 px-4 py-3 text-left transition-colors hover:bg-cream ${i > 0 ? "border-t border-border-soft" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-[13px] text-ink">
                  <span className="font-medium">{s.username ?? s.email ?? "anon"}</span>
                  <span className="text-ink-light">·</span>
                  <span className="text-[11px] text-ink-muted">
                    {formatTimestamp(s.startedAt)}
                  </span>
                  <span className="text-ink-light">·</span>
                  <span className="text-[11px] text-ink-muted">
                    {formatSpan(s.startedAt, s.endedAt)}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                  <span>
                    {s.turnCount} turno{s.turnCount === 1 ? "" : "s"}
                  </span>
                  <span className="text-ink-light">·</span>
                  <span>
                    {s.userTurns} usuario / {s.assistantTurns} asistente
                  </span>
                  {s.skillsUsed.length > 0 && (
                    <>
                      <span className="text-ink-light">·</span>
                      <span className="flex flex-wrap gap-1">
                        {s.skillsUsed.map((skill) => (
                          <span
                            key={skill}
                            className="rounded-full bg-cream-deep px-2 py-0.5 text-[10px] text-ink-mid"
                          >
                            {skill}
                          </span>
                        ))}
                      </span>
                    </>
                  )}
                </div>
                <div className="mt-1 font-mono text-[10px] text-ink-light truncate">
                  {s.sessionId}
                </div>
              </div>
              <ChevronRight size={16} className="mt-2 shrink-0 text-ink-light" />
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between text-[12px] text-ink-muted">
          <span>
            Página {data.page} de {totalPages} · {data.total} sesiones
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="rounded-full border border-border-soft bg-paper px-3 py-1 disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={data.page >= totalPages}
              className="rounded-full border border-border-soft bg-paper px-3 py-1 disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Session detail ────────────────────────────────────────────── */

function SessionDetail({
  sessionId,
  user,
  onBack,
}: {
  sessionId: string
  user: string | null
  onBack: () => void
}) {
  const { data, isLoading, error } = useVoiceTranscriptTurns({
    sessionId,
    perPage: 200,
  })

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink"
      >
        <ChevronLeft size={14} />
        Volver a la lista
      </button>

      <div className="rounded-2xl border border-border-soft bg-paper p-4">
        <div className="text-[10px] uppercase tracking-[0.15em] text-ink-muted">
          Sesión
        </div>
        <div className="mt-1 font-mono text-[11px] text-ink-light break-all">
          {sessionId}
        </div>
        {user && (
          <div className="mt-2 text-[13px] text-ink">
            <span className="text-ink-muted">Usuario:</span> {user}
          </div>
        )}
        {data && (
          <div className="mt-2 text-[12px] text-ink-muted">
            {data.rows.length} turno{data.rows.length === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {isLoading && <Empty>Cargando turnos…</Empty>}
      {error && <Empty>Error al cargar la sesión.</Empty>}
      {!isLoading && !error && data?.rows.length === 0 && (
        <Empty>Esta sesión no tiene turnos registrados.</Empty>
      )}

      {data && data.rows.length > 0 && (
        <div className="space-y-2">
          {data.rows.map((t) => (
            <TurnCard key={t.id} turn={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function TurnCard({ turn }: { turn: VoiceTranscriptTurn }) {
  const isUser = turn.role === "user"
  return (
    <div
      className={`rounded-2xl border p-3 ${
        isUser
          ? "border-border-soft bg-cream-deep"
          : "border-border-soft bg-paper"
      }`}
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-ink-muted">
        <span>{isUser ? "Usuario" : "Asistente"}</span>
        <span className="text-ink-light">·</span>
        <span>{formatTimestamp(turn.createdAt)}</span>
        {turn.skillUsed && (
          <>
            <span className="text-ink-light">·</span>
            <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] normal-case tracking-normal text-cream">
              {turn.skillUsed}
            </span>
          </>
        )}
      </div>
      <div className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-ink">
        {turn.content}
      </div>
    </div>
  )
}
