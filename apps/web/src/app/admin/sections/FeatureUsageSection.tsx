"use client"

/**
 * FeatureUsageSection — «Uso de funciones» (PRO-1025,
 * specs/feature-usage.md): una fila por función de Mimoia desde
 * `GET /admin/feature-usage`, con filtros (días, tipo, por hogar o persona,
 * orden) y el bloque «Trucos de la newsletter»: a cuántos se les puede
 * proponer cada una. Solo cifras; la API ya da «menos de 5» en los grupos
 * pequeños y aquí se pinta tal cual.
 */

import { useMemo, useState, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

type Cell = number | "menos de 5"

export interface FeatureUsageRow {
  id: string
  nombre: string
  kind: "accion" | "ajuste"
  per: "hogar" | "persona"
  unit: "hogares" | "personas"
  users: Cell
  active: Cell
  lapsed: Cell
  never: Cell
  households: Cell
  uses30d: Cell
  usesTotal: Cell
  medianDaysSinceLast: number | null | "menos de 5"
  share: number | null
}

export interface FeatureTrick {
  id: string
  nombre: string
  per: "hogar" | "persona"
  unit: "hogares" | "personas"
  never: Cell
  lapsed: Cell
}

export interface FeatureUsageReport {
  days: number
  countedUntil: string | null
  base: { households: Cell; people: Cell }
  features: FeatureUsageRow[]
  tricks: FeatureTrick[]
}

const DAYS = [7, 30, 90] as const
const KINDS = [
  { key: "todas", label: "Todas" },
  { key: "accion", label: "Acciones" },
  { key: "ajuste", label: "Ajustes" },
] as const
const PERS = [
  { key: "todas", label: "Hogar y persona" },
  { key: "hogar", label: "Por hogar" },
  { key: "persona", label: "Por persona" },
] as const
const ORDERS = [
  { key: "catalogo", label: "Orden del catálogo" },
  { key: "mas", label: "Más usadas" },
  { key: "menos", label: "Menos usadas" },
] as const

/** Para ordenar: «menos de 5» va entre el 0 y el 5. */
const sortValue = (c: Cell) => (typeof c === "number" ? c : 2.5)
const show = (c: Cell | null) => (c == null ? "—" : typeof c === "number" ? c.toLocaleString("es-ES") : c)

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[44px] rounded-full border px-4 text-[13px] ${active ? "border-ink bg-ink text-cream" : "border-border bg-paper text-ink"}`}
    >
      {children}
    </button>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[16px] font-semibold leading-tight text-ink">{value}</div>
      <div className="text-[11px] text-ink-muted">{label}</div>
    </div>
  )
}

export function FeatureUsageSection() {
  const [days, setDays] = useState<number>(30)
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("todas")
  const [per, setPer] = useState<(typeof PERS)[number]["key"]>("todas")
  const [order, setOrder] = useState<(typeof ORDERS)[number]["key"]>("catalogo")
  const q = useQuery({
    queryKey: ["admin", "feature-usage", days],
    queryFn: () => api.get<FeatureUsageReport>(`/admin/feature-usage?days=${days}`),
  })

  const rows = useMemo(() => {
    const list = (q.data?.features ?? []).filter((f) => (kind === "todas" || f.kind === kind) && (per === "todas" || f.per === per))
    if (order === "catalogo") return list
    const dir = order === "mas" ? -1 : 1
    return [...list].sort((a, b) => dir * (sortValue(a.users) - sortValue(b.users)) || a.nombre.localeCompare(b.nombre, "es"))
  }, [q.data, kind, per, order])
  const tricks = (q.data?.tricks ?? []).filter((t) => per === "todas" || t.per === per)

  return (
    <section data-testid="feature-usage-section" className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Días">
          {DAYS.map((d) => (
            <Chip key={d} active={days === d} onClick={() => setDays(d)}>
              {d} días
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tipo">
          {KINDS.map((k) => (
            <Chip key={k.key} active={kind === k.key} onClick={() => setKind(k.key)}>
              {k.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Por">
          {PERS.map((p) => (
            <Chip key={p.key} active={per === p.key} onClick={() => setPer(p.key)}>
              {p.label}
            </Chip>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-muted">
          Ordenar
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value as (typeof ORDERS)[number]["key"])}
            className="min-h-[44px] rounded-full border border-border bg-paper px-3 text-ink"
          >
            {ORDERS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {q.isLoading && <p className="text-eyebrow">Cargando…</p>}
      {q.isError && <p className="text-[14px] text-ink-muted">No se ha podido cargar el uso de funciones.</p>}

      {q.data && (
        <p className="text-[12px] text-ink-muted">
          {show(q.data.base.households)} hogares y {show(q.data.base.people)} personas
          {q.data.countedUntil
            ? ` · contado hasta el ${new Date(q.data.countedUntil).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}`
            : " · aún sin pasada nocturna"}
        </p>
      )}

      {q.data && (
        <ul className="space-y-2" aria-label="Funciones">
          {rows.map((f) => (
            <li key={f.id} data-testid="feature-usage-row" className="rounded-2xl border border-border-soft bg-paper p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[15px] font-medium text-ink">{f.nombre}</p>
                <p className="shrink-0 text-[11px] text-ink-muted">
                  {f.kind === "accion" ? "acción" : "ajuste"} · por {f.per}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
                <Figure label={`${f.unit} la usan`} value={show(f.users)} />
                <Figure label={`en ${q.data.days} días`} value={show(f.active)} />
                <Figure label="nunca" value={show(f.never)} />
                <Figure label="usos en 30 días" value={show(f.uses30d)} />
                <Figure label="usos en total" value={show(f.usesTotal)} />
                <Figure
                  label="días desde la última (mediana)"
                  value={f.medianDaysSinceLast == null ? "—" : String(f.medianDaysSinceLast)}
                />
              </div>
            </li>
          ))}
          {rows.length === 0 && <li className="text-[14px] text-ink-muted">Ninguna función con estos filtros.</li>}
        </ul>
      )}

      {q.data && (
        <section aria-labelledby="feature-tricks-title" data-testid="feature-tricks" className="space-y-2">
          <h2 id="feature-tricks-title" className="text-[18px] font-semibold text-ink">
            Trucos de la newsletter
          </h2>
          <p className="max-w-md text-[13px] text-ink-muted">
            A cuántos se les puede proponer cada función: los que no la han usado nunca y los que la dejaron (no la usan en {q.data.days} días).
          </p>
          <ol className="space-y-1">
            {tricks.map((t) => (
              <li key={t.id} data-testid="feature-trick" className="flex items-baseline justify-between gap-3 border-b border-border-soft py-2 text-[14px]">
                <span className="text-ink">{t.nombre}</span>
                <span className="shrink-0 text-right text-[12px] text-ink-muted">
                  {show(t.never)} {t.unit} nunca · {show(t.lapsed)} la dejaron
                </span>
              </li>
            ))}
            {tricks.length === 0 && <li className="text-[14px] text-ink-muted">Todos usan ya todas las funciones.</li>}
          </ol>
        </section>
      )}
    </section>
  )
}
