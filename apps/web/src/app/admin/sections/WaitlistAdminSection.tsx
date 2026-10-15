"use client"

/**
 * WaitlistAdminSection — «Lista de espera» in the admin (PRO-97).
 *
 * Inscritos and por canal (GET /admin/waitlist), the suggested batch with
 * name and email of each person (GET /admin/waitlist/next-batch, admin JWT
 * only), «Quitar» per person, and «Invitar a estas N personas» with a
 * confirmation: POST /admin/waitlist/invite marks the batch and emails each
 * one their one-time link. Per batch: invitados, registrados, de baja.
 * Spec: specs/admin-dashboard.md, specs/waitlist.md.
 */

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  WAITLIST_CURRENT_METHOD_LABELS,
  WAITLIST_HOUSEHOLD_SIZE_LABELS,
  WAITLIST_PLANNER_ROLE_LABELS,
  WAITLIST_PLATFORM_LABELS,
  type WaitlistCurrentMethod,
  type WaitlistHouseholdSize,
  type WaitlistPlannerRole,
  type WaitlistPlatform,
} from "@ona/shared"
import { api } from "@/lib/api"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"
import { Empty } from "./shared"

interface Report {
  totals: { entries: number; active: number; last7Days: number; wantsWhatsapp: number; inTargetSegment: number }
  status: { waiting: number; invited: number; joined: number; unsubscribed: number }
  sources: { bySource: Array<{ source: string; count: number }> }
  batches: Array<{ batch: number; size: number; joined: number; unsubscribed: number }>
}

interface Person {
  id: string
  email: string | null
  firstName: string | null
  createdAt: string
  householdSize: WaitlistHouseholdSize
  plannerRole: WaitlistPlannerRole
  currentMethod: WaitlistCurrentMethod
  platform: WaitlistPlatform
  wantsWhatsapp: boolean
  source: string
  target: boolean
  withReferrer: boolean
}

interface NextBatch {
  size: number
  counts: { waiting: number; waitingInTarget: number; selected: number }
  people: Person[]
}

interface InviteResult {
  batch: number
  skipped: number
  invited: Array<{
    id: string
    email: string | null
    firstName: string | null
    entryUrl: string
    emailStatus: "sent" | "skipped" | "failed" | "not_requested"
  }>
  email: { sent: number; skipped: number; failed: number }
}

const EMAIL_STATUS: Record<InviteResult["invited"][number]["emailStatus"], string> = {
  sent: "correo enviado",
  skipped: "sin enviar (correo no configurado)",
  failed: "falló el envío",
  not_requested: "sin correo",
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-border-soft bg-paper p-4">
      <div className={`${DISPLAY_UI} text-[1.8rem] leading-none text-ink`}>{value}</div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.15em] text-ink-muted">{label}</div>
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function WaitlistAdminSection() {
  const qc = useQueryClient()
  const [size, setSize] = useState(20)
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<InviteResult | null>(null)

  const report = useQuery({
    queryKey: ["admin", "waitlist", "report"],
    queryFn: () => api.get<Report>("/admin/waitlist?days=30&batchSize=1"),
  })
  const next = useQuery({
    queryKey: ["admin", "waitlist", "next-batch", size],
    queryFn: () => api.get<NextBatch>(`/admin/waitlist/next-batch?size=${size}`),
  })

  const people = next.data?.people ?? []
  const chosen = useMemo(() => people.filter((p) => !removed.has(p.id)), [people, removed])
  const left = useMemo(() => people.filter((p) => removed.has(p.id)), [people, removed])

  const invite = useMutation({
    mutationFn: () => api.post<InviteResult>("/admin/waitlist/invite", { ids: chosen.map((p) => p.id) }),
    onSuccess: (r) => {
      setResult(r)
      setConfirming(false)
      setRemoved(new Set())
      qc.invalidateQueries({ queryKey: ["admin", "waitlist"] })
    },
  })

  function toggle(id: string) {
    setRemoved((prev) => {
      const nextSet = new Set(prev)
      if (nextSet.has(id)) nextSet.delete(id)
      else nextSet.add(id)
      return nextSet
    })
    setConfirming(false)
  }

  const r = report.data
  return (
    <section data-testid="waitlist-admin" className="space-y-8">
      {/* Inscritos */}
      <div>
        <h2 className="text-eyebrow mb-3">Inscritos</h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="en la lista" value={r?.totals.active ?? "—"} />
          <Stat label="esperando" value={r?.status.waiting ?? "—"} />
          <Stat label="invitados" value={r?.status.invited ?? "—"} />
          <Stat label="ya registrados" value={r?.status.joined ?? "—"} />
        </div>
        {r && (
          <p className="mt-2 text-[12px] text-ink-muted">
            {plural(r.totals.last7Days, "alta", "altas")} en los últimos 7 días ·{" "}
            {plural(r.totals.inTargetSegment, "hogar", "hogares")} del segmento objetivo ·{" "}
            {r.totals.wantsWhatsapp} quieren WhatsApp
          </p>
        )}
      </div>

      {/* Por canal */}
      <div>
        <h2 className="text-eyebrow mb-3">Por canal</h2>
        {r && r.sources.bySource.length === 0 && <Empty>Aún no hay nadie en la lista.</Empty>}
        <ul className="flex flex-wrap gap-2" data-testid="waitlist-sources">
          {(r?.sources.bySource ?? []).map((s) => (
            <li key={s.source} className="rounded-full border border-border-soft bg-paper px-3 py-1.5 text-[13px] text-ink">
              {s.source} <span className="text-ink-muted">· {s.count}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Tanda sugerida */}
      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-eyebrow">Tanda sugerida</h2>
            <p className="mt-1 max-w-xl text-[12px] text-ink-muted">
              Primero el segmento objetivo; quien vino con el enlace de otra persona entra con ella. Quita a quien
              no quieras invitar ahora: sigue en la lista.
            </p>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-ink-muted">
            Tamaño
            <input
              type="number"
              min={1}
              max={200}
              value={size}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n) && n >= 1 && n <= 200) setSize(Math.floor(n))
              }}
              className="w-20 rounded-lg border border-border px-3 py-2 text-[14px] text-ink"
            />
          </label>
        </div>

        {next.isLoading && <p className="text-[12px] italic text-ink-muted">Cargando la tanda…</p>}
        {next.isError && <p className="text-[12px] text-warn-text">No se ha podido cargar la tanda.</p>}
        {next.data && people.length === 0 && <Empty>No queda nadie esperando.</Empty>}

        <ul className="grid gap-2 lg:grid-cols-2" data-testid="waitlist-batch">
          {chosen.map((p) => (
            <li
              key={p.id}
              data-testid="waitlist-person"
              className="flex items-start justify-between gap-3 rounded-2xl border border-border-soft bg-paper p-4"
            >
              <div className="min-w-0">
                <p className="font-semibold text-ink">{p.firstName || "Sin nombre"}</p>
                <p className="break-all text-[13px] text-ink-mid">{p.email}</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
                  {WAITLIST_HOUSEHOLD_SIZE_LABELS[p.householdSize] ?? p.householdSize} ·{" "}
                  planifica: {WAITLIST_PLANNER_ROLE_LABELS[p.plannerRole] ?? p.plannerRole} ·{" "}
                  {WAITLIST_CURRENT_METHOD_LABELS[p.currentMethod] ?? p.currentMethod} ·{" "}
                  {WAITLIST_PLATFORM_LABELS[p.platform] ?? p.platform} · canal: {p.source}
                  {p.wantsWhatsapp ? " · WhatsApp" : ""}
                  {p.withReferrer ? " · entra con quien le invitó" : ""}
                  {p.target ? "" : " · fuera del segmento"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => toggle(p.id)}
                aria-label={`Quitar a ${p.email ?? p.firstName ?? "esta persona"}`}
                className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-border-soft px-4 text-[13px] font-medium text-ink-mid hover:border-ink"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>

        {left.length > 0 && (
          <div className="mt-4">
            <p className="text-[12px] text-ink-muted">Quitadas de esta tanda (siguen en la lista):</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {left.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    className="inline-flex min-h-[44px] items-center rounded-full border border-dashed border-border-soft px-3 text-[13px] text-ink-mid hover:border-ink"
                  >
                    {p.email} · volver a añadir
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {chosen.length > 0 && !confirming && (
          <button
            type="button"
            onClick={() => {
              setResult(null)
              setConfirming(true)
            }}
            className="mt-5 inline-flex min-h-[48px] items-center rounded-full bg-ink px-6 text-[14px] font-semibold text-cream hover:bg-terracotta-deep"
          >
            {chosen.length === 1 ? "Invitar a esta persona" : `Invitar a estas ${chosen.length} personas`}
          </button>
        )}

        {confirming && (
          <div
            role="alertdialog"
            aria-labelledby="waitlist-confirm-title"
            className="mt-5 rounded-2xl border border-ink bg-cream p-4"
          >
            <p id="waitlist-confirm-title" className="font-semibold text-ink">
              ¿Invitar a {plural(chosen.length, "persona", "personas")}?
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-mid">
              Cada una recibirá un correo con su enlace personal para crear la cuenta, y un único recordatorio a
              los 3 días si no se ha registrado. No se puede deshacer.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => invite.mutate()}
                disabled={invite.isPending}
                className="inline-flex min-h-[44px] items-center rounded-full bg-terracotta-deep px-5 text-[13px] font-semibold text-cream disabled:opacity-50"
              >
                {invite.isPending ? "Invitando…" : "Sí, invitar y enviar el correo"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="inline-flex min-h-[44px] items-center rounded-full border border-border-soft px-5 text-[13px] font-medium text-ink-mid"
              >
                Cancelar
              </button>
            </div>
            {invite.isError && <p className="mt-2 text-[12px] text-warn-text">No se ha podido invitar. Prueba otra vez.</p>}
          </div>
        )}

        {result && (
          <div data-testid="waitlist-invite-result" className="mt-5 rounded-2xl border border-border-soft bg-paper p-4">
            <p className="font-semibold text-ink">
              Tanda {result.batch}: {plural(result.invited.length, "persona invitada", "personas invitadas")}.
            </p>
            <p className="mt-1 text-[13px] text-ink-mid">
              Correos: {result.email.sent} enviados
              {result.email.skipped ? `, ${result.email.skipped} sin enviar` : ""}
              {result.email.failed ? `, ${result.email.failed} fallidos` : ""}
              {result.skipped ? ` · ${plural(result.skipped, "ya no estaba esperando", "ya no estaban esperando")}` : ""}.
            </p>
            {result.invited.some((p) => p.emailStatus !== "sent") && (
              <>
                <p className="mt-3 text-[12px] text-ink-muted">
                  A quien no le ha llegado, escríbele tú con su enlace (es personal y de un solo uso):
                </p>
                <ul className="mt-2 space-y-2">
                  {result.invited
                    .filter((p) => p.emailStatus !== "sent")
                    .map((p) => (
                      <li key={p.id} className="text-[13px]">
                        <span className="font-medium text-ink">{p.email}</span>{" "}
                        <span className="text-ink-muted">({EMAIL_STATUS[p.emailStatus]})</span>
                        <br />
                        <span className="break-all font-mono text-[12px] text-ink-mid">{p.entryUrl}</span>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>

      {/* Por tanda */}
      <div>
        <h2 className="text-eyebrow mb-3">Tandas</h2>
        {r && r.batches.length === 0 && <Empty>Aún no has invitado ninguna tanda.</Empty>}
        {r && r.batches.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border-soft bg-paper px-4">
            <table className="w-full text-left text-[13px]" data-testid="waitlist-batches">
              <thead className="text-[11px] uppercase tracking-[0.1em] text-ink-muted">
                <tr>
                  <th className="py-2 pr-3">Tanda</th>
                  <th className="py-2 pr-3">Invitados</th>
                  <th className="py-2 pr-3">Registrados</th>
                  <th className="py-2 pr-3">Sin registrarse</th>
                  <th className="py-2 pr-3">De baja</th>
                </tr>
              </thead>
              <tbody>
                {r.batches.map((b) => (
                  <tr key={b.batch} className="border-t border-border-soft">
                    <td className="py-2 pr-3 font-semibold text-ink">{b.batch}</td>
                    <td className="py-2 pr-3">{b.size}</td>
                    <td className="py-2 pr-3">{b.joined}</td>
                    <td className="py-2 pr-3">{Math.max(0, b.size - b.joined - b.unsubscribed)}</td>
                    <td className="py-2 pr-3">{b.unsubscribed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
