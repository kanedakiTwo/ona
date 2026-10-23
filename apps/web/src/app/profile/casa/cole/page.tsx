"use client"

/**
 * /profile/casa/cole — Menú del comedor escolar (PRO-224).
 *
 * The household uploads a photo or PDF of the school's monthly menu; Mimo
 * reads the main dish of each school day and its group, shows it to fix,
 * and saves it. The menu's dinner on those days doesn't repeat the group
 * («para no repetir»: no health claims, constitution §6).
 */
import { useState } from "react"
import { Trash2, Upload } from "lucide-react"
import { FOOD_GROUPS, FOOD_GROUP_LABELS, isFoodGroup, type SchoolLunch } from "@ona/shared"
import { useReadSchoolMenu, useSaveSchoolMenu, useSchoolMenu } from "@/hooks/useSchoolMenu"
import { ApiError } from "@/lib/api"
import { Accent, SUB_EYEBROW, SUB_INPUT, SUB_LIST, SubPage } from "@/components/profile/SubPage"

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]

/** «Lunes 3 nov». */
function schoolDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const day = DAYS[d.getUTCDay()]
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** The API's own words for a 4xx; never a bare «Internal server error» (2026-10-23). */
function schoolMenuReadError(e: unknown): string {
  if (e instanceof ApiError && e.status < 500) return e.message
  if (e instanceof ApiError && e.status === 503 && e.message) return e.message
  return "No he podido leer el menú ahora. Prueba otra vez en un momento o mándamelo por WhatsApp con «menú del cole»."
}

export default function SchoolMenuPage() {
  const { data, isLoading } = useSchoolMenu()
  const read = useReadSchoolMenu()
  const save = useSaveSchoolMenu()
  const [draft, setDraft] = useState<SchoolLunch[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    read.mutate(file, {
      onSuccess: (r) => setDraft(r.days),
      onError: (e) => setError(schoolMenuReadError(e)),
    })
  }

  function patch(i: number, next: Partial<SchoolLunch>) {
    setDraft((d) => (d ? d.map((x, j) => (j === i ? { ...x, ...next } : x)) : d))
  }

  function saveDraft() {
    if (!draft) return
    const days = draft.filter((d) => d.dish.trim()).map((d) => ({ ...d, dish: d.dish.trim() }))
    save.mutate(
      { days },
      {
        onSuccess: () => setDraft(null),
        onError: (e) => setError(e instanceof Error ? e.message : "No se ha podido guardar."),
      },
    )
  }

  const saved = data?.days ?? []

  return (
    <SubPage
      eyebrow="Mi casa"
      title={
        <>
          Menú del <Accent>cole</Accent>
        </>
      }
      intro="Sube la foto o el PDF del menú del comedor. Leo el plato principal de cada día y, esas noches, la cena no repite lo de mediodía (si comieron lentejas, la cena no es de legumbres). También puedes mandármelo por WhatsApp con «menú del cole» en el mensaje."
    >
      {error && (
        <div role="alert" className="mb-5 rounded-2xl border border-terracotta-deep/25 bg-warn-bg px-4 py-3 text-[14px] text-terracotta-deep">
          {error}
        </div>
      )}

      {!draft && (
        <label className="inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-medium text-cream">
          <Upload size={18} aria-hidden="true" />
          {read.isPending ? "Leyendo el menú…" : "Subir foto o PDF"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            data-testid="school-menu-file"
            disabled={read.isPending}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
      )}

      {draft && (
        <section aria-label="Lo que he leído" className="mt-2">
          <h2 className={`${SUB_EYEBROW} mb-1`}>Lo que he leído · {draft.length} días</h2>
          <p className="mb-3 text-[13px] text-ink-soft">Corrige lo que no cuadre antes de guardarlo.</p>
          <ul className={SUB_LIST}>
            {draft.map((d, i) => (
              <li key={d.date} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <span className="w-32 shrink-0 text-[14px] font-medium text-ink">{schoolDayLabel(d.date)}</span>
                <input
                  aria-label={`Plato del ${schoolDayLabel(d.date)}`}
                  className={`${SUB_INPUT} flex-1`}
                  value={d.dish}
                  maxLength={120}
                  onChange={(e) => patch(i, { dish: e.target.value })}
                />
                <select
                  aria-label={`Grupo del ${schoolDayLabel(d.date)}`}
                  className={`${SUB_INPUT} sm:w-40`}
                  value={d.group ?? ""}
                  onChange={(e) => patch(i, { group: isFoodGroup(e.target.value) ? e.target.value : null })}
                >
                  <option value="">Sin grupo</option>
                  {FOOD_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {FOOD_GROUP_LABELS[g]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Quitar el ${schoolDayLabel(d.date)}`}
                  className="inline-flex min-h-[44px] items-center justify-center text-ink-muted hover:text-ink"
                  onClick={() => setDraft((x) => (x ? x.filter((_, j) => j !== i) : x))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={save.isPending || draft.length === 0}
              onClick={saveDraft}
              className="min-h-[48px] rounded-full bg-ink px-5 text-[15px] font-medium text-cream disabled:opacity-50"
            >
              {save.isPending ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="min-h-[48px] rounded-full px-4 text-[15px] text-ink-mid">
              Descartar
            </button>
          </div>
        </section>
      )}

      <section className="mt-10">
        <h2 className={`${SUB_EYEBROW} mb-3`}>Guardado</h2>
        {isLoading ? (
          <div className="h-14 animate-pulse rounded-[20px] bg-bone" />
        ) : saved.length === 0 ? (
          <p className="text-[14px] text-ink-soft">Aún no hay menú del cole guardado.</p>
        ) : (
          <ul className={SUB_LIST} data-testid="school-menu-saved">
            {saved.map((d) => (
              <li key={d.date} className="flex min-h-[52px] items-center gap-3 py-2 pl-4 pr-2">
                <span className="w-32 shrink-0 text-[14px] font-medium text-ink">{schoolDayLabel(d.date)}</span>
                <span className="min-w-0 flex-1 text-[15px] text-ink">
                  {d.dish}
                  {d.group && <span className="ml-2 text-[12px] text-ink-muted">{FOOD_GROUP_LABELS[d.group]}</span>}
                </span>
                <button
                  type="button"
                  aria-label={`Quitar el ${schoolDayLabel(d.date)}`}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-muted hover:text-ink"
                  onClick={() => save.mutate({ days: [], clear: [d.date] })}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SubPage>
  )
}
