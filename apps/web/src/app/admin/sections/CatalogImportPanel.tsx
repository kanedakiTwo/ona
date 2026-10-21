"use client"

/**
 * CatalogImportPanel — «Importar una tanda» in Admin → Recetas pendientes
 * (specs/catalog-import.md). Upload or paste Cocina's batch file, check it
 * here (same schema as the API, problems in Spanish), see what an import
 * would skip, and launch it: the API imports in the background (each recipe
 * rewritten by the AI, minutes per batch) and this panel follows it — how
 * many are done, and what happened to each. Everything lands as a draft.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react"
import {
  CATALOG_IMPORT_JOB_STATUS_LABELS,
  CATALOG_IMPORT_REJECT_LABELS,
  buildCatalogImportPayload,
  suggestCatalogBatchId,
  type CatalogImportCheckView,
  type CatalogImportJobView,
  type CatalogImportRequest,
} from "@ona/shared"
import { useCheckImport, useImportJobs, useRefreshDrafts, useStartImport } from "@/hooks/useCatalogReview"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

export function CatalogImportPanel() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useState("")
  const [fileName, setFileName] = useState<string | null>(null)
  const [batch, setBatch] = useState("")
  const [batchTouched, setBatchTouched] = useState(false)
  const [problems, setProblems] = useState<string[] | null>(null)
  const [ready, setReady] = useState<{ payload: CatalogImportRequest; check: CatalogImportCheckView } | null>(null)
  const [started, setStarted] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const check = useCheckImport()
  const start = useStartImport()

  function changed() {
    setProblems(null)
    setReady(null)
    setStarted(null)
    start.reset()
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    changed()
    setText(await f.text())
    setFileName(f.name)
    if (!batchTouched) setBatch(suggestCatalogBatchId(f.name))
  }

  function comprobar() {
    changed()
    const built = buildCatalogImportPayload({ text, fileName, batch })
    if (!built.ok) {
      setProblems(built.problems)
      return
    }
    check.mutate(built.payload, {
      onSuccess: (view) => setReady({ payload: built.payload, check: view }),
      onError: (err) => setProblems([(err as Error).message]),
    })
  }

  function importar() {
    if (!ready) return
    start.mutate(ready.payload, {
      onSuccess: ({ job }) => {
        setStarted(job.batch)
        setOpen(false)
        setReady(null)
        setText("")
        setFileName(null)
        setBatch("")
        setBatchTouched(false)
        if (fileInput.current) fileInput.current.value = ""
      },
    })
  }

  const toSkip = ready?.check.recipes.filter((r) => r.duplicateOf) ?? []
  const toImport = (ready?.check.recipes.length ?? 0) - toSkip.length

  return (
    <section aria-labelledby="catalog-import-title" data-testid="catalog-import" className="rounded-[20px] border border-border-soft bg-paper p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="catalog-import-title" className="text-eyebrow text-ink-muted">Importar una tanda</h2>
          <p className="mt-1 text-[13px] text-ink-mid">El JSON de Cocina entra como borrador: no se publica nada.</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="catalog-import-form"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-ink px-4 text-[13px] font-semibold text-ink hover:bg-ink hover:text-cream"
        >
          {open ? "Cerrar" : "Subir un JSON"}
        </button>
      </div>

      {open && (
        <div id="catalog-import-form">
          <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-ink-mid">
            Sube el fichero de la tanda o pega su contenido. Primero lo comprobamos; al importarlo, cada receta se reescribe con
            nuestras palabras y entra como <strong className="font-semibold text-ink">borrador</strong>, sin publicarse hasta que tú lo
            digas. Tarda unos minutos y sigue aunque cierres la página.
          </p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <span className="block text-[13px] font-medium text-ink">Fichero JSON</span>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-full border border-border bg-cream px-4 text-[13px] font-medium text-ink focus-within:border-ink hover:border-ink">
                    Elegir fichero
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".json,application/json"
                      onChange={onFile}
                      data-testid="catalog-import-file"
                      className="sr-only"
                    />
                  </label>
                  <span className="min-w-0 break-all text-[12px] text-ink-muted">{fileName ?? "Ningún fichero elegido"}</span>
                </div>
              </div>
              <label className="block text-[13px] font-medium text-ink">
                Nombre de la tanda
                <input
                  value={batch}
                  onChange={(e) => {
                    setBatch(e.target.value)
                    setBatchTouched(true)
                    changed()
                  }}
                  placeholder="cocina-02"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="mt-1.5 block min-h-[44px] w-full rounded-[14px] border border-border bg-paper px-3 font-mono text-[14px] text-ink focus:border-ink focus:outline-none"
                />
                <span className="mt-1 block text-[12px] font-normal text-ink-muted">Minúsculas, números y guiones. Si ya existe, se añaden a ella.</span>
              </label>
            </div>
            <label className="block text-[13px] font-medium text-ink">
              O pega el JSON
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  changed()
                }}
                rows={7}
                spellCheck={false}
                placeholder='{ "source": { "origin": "cocina" }, "recipes": [ … ] }'
                className="mt-1.5 block w-full rounded-[14px] border border-border bg-paper px-3 py-2 font-mono text-[12px] leading-snug text-ink focus:border-ink focus:outline-none"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={comprobar}
              disabled={check.isPending || !text.trim()}
              className="inline-flex min-h-[44px] items-center rounded-full border border-ink px-5 text-[13px] font-semibold text-ink disabled:opacity-40"
            >
              {check.isPending ? "Comprobando…" : "Comprobar"}
            </button>
          </div>

          {problems && (
            <div role="alert" data-testid="catalog-import-problems" className="mt-4 rounded-[16px] bg-warn-bg p-4 text-[13px] text-warn-text">
              <p className="font-semibold">El fichero aún no vale:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {ready && (
            <div data-testid="catalog-import-ready" className="mt-4 rounded-[16px] border border-ink bg-cream p-4 text-[13px] text-ink-mid">
              <p className="text-[14px] font-semibold text-ink">
                {plural(ready.check.recipes.length, "receta", "recetas")} {ready.check.origin === "miguel" ? "de tus fuentes" : "de Cocina"}
                {ready.check.book ? ` («${ready.check.book}»)` : ""} para la tanda <span className="font-mono">{ready.check.batch}</span>.
              </p>
              {toSkip.length > 0 && (
                <>
                  <p className="mt-2">{toSkip.length === 1 ? "Se saltará 1 porque ya está" : `Se saltarán ${toSkip.length} porque ya están`} en el catálogo:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {toSkip.map((r) => (
                      <li key={r.name}>
                        {r.name} <span className="text-ink-muted">= {r.duplicateOf}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {ready.check.alreadyInBatch > 0 && (
                <p className="mt-2">La tanda ya tiene {plural(ready.check.alreadyInBatch, "receta", "recetas")}; las nuevas se añaden.</p>
              )}
              {ready.check.warnings.map((w) => (
                <p key={w} className="mt-2 text-warn-text">
                  {w}
                </p>
              ))}
              <button
                type="button"
                onClick={importar}
                disabled={start.isPending || toImport === 0}
                className="mt-3 inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-cream hover:bg-terracotta-deep disabled:opacity-40"
              >
                {start.isPending ? "Empezando…" : toImport === 0 ? "No hay nada nuevo que importar" : `Importar ${plural(toImport, "receta", "recetas")} como borrador`}
              </button>
              {start.isError && (
                <p role="alert" className="mt-2 text-warn-text">
                  {(start.error as Error).message}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {started && (
        <p role="status" className="mt-4 text-[13px] text-ink">
          Importando la tanda <span className="font-mono">{started}</span> en segundo plano. Las recetas van apareciendo abajo como borrador.
        </p>
      )}

      <ImportJobs />
    </section>
  )
}

const OUTCOME_MARK: Record<CatalogImportJobView["outcomes"][number]["status"], { mark: string; label: string; className: string }> = {
  draft: { mark: "✓", label: "en borrador", className: "text-ink" },
  duplicate: { mark: "=", label: "repetida", className: "text-ink-muted" },
  rejected: { mark: "✗", label: "rechazada", className: "text-warn-text" },
}

function outcomeNote(o: CatalogImportJobView["outcomes"][number]): string | null {
  if (o.status === "duplicate") return o.duplicateOf ? `ya está: ${o.duplicateOf}` : "ya está"
  if (o.status === "rejected") {
    const why = CATALOG_IMPORT_REJECT_LABELS[o.reason ?? ""] ?? o.reason ?? "rechazada"
    return o.detail ? `${why}: ${o.detail}` : why
  }
  const notes = [o.allergenDoubt ? "duda de alérgenos" : null, o.auditIssues?.length ? "aviso de la auditoría" : null].filter(Boolean)
  return notes.length ? notes.join(" · ") : null
}

function JobOutcomes({ job }: { job: CatalogImportJobView }) {
  return (
    <ul className="space-y-1 pb-1">
      {job.outcomes.map((o, i) => {
        const m = OUTCOME_MARK[o.status]
        const note = outcomeNote(o)
        return (
          <li key={`${o.name}-${i}`} className="grid grid-cols-[18px_1fr] gap-1.5 text-[12px] leading-snug">
            <span aria-label={m.label} className={`font-semibold ${m.className}`}>
              {m.mark}
            </span>
            <span className="min-w-0 break-words text-ink">
              {o.status === "draft" && o.recipeId ? (
                <a href={`/recipes/${o.recipeId}`} className="underline underline-offset-2">
                  {o.name}
                </a>
              ) : (
                o.name
              )}
              {note && <span className="text-ink-muted"> — {note}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const jobCounts = (j: CatalogImportJobView) =>
  `${j.done} de ${j.total} · ${j.counts.draft} en borrador · ${plural(j.counts.duplicate, "repetida", "repetidas")} · ${plural(j.counts.rejected, "rechazada", "rechazadas")}`

function StatusChip({ job }: { job: CatalogImportJobView }) {
  const tone = job.status === "running" ? "bg-ink text-cream" : job.status === "done" ? "border border-ink text-ink" : "bg-warn-bg text-warn-text"
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tone}`}>{CATALOG_IMPORT_JOB_STATUS_LABELS[job.status]}</span>
}

function ImportJobs() {
  const jobs = useImportJobs()
  const refreshDrafts = useRefreshDrafts()
  const running = jobs.data?.jobs.find((j) => j.status === "running")
  const progressKey = running ? `${running.id}:${running.done}` : jobs.data?.jobs[0] ? `${jobs.data.jobs[0].id}:${jobs.data.jobs[0].status}` : ""

  // Drafts arrive while the import runs (and once more when it ends).
  useEffect(() => {
    if (progressKey) void refreshDrafts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressKey])

  const list = (jobs.data?.jobs ?? []).slice(0, 3)
  if (list.length === 0) return null
  return (
    <div className="mt-5">
      <h3 className="text-eyebrow text-ink-muted">Últimas importaciones</h3>
      <ul className="mt-2 space-y-2">
        {list.map((j) =>
          j.status === "running" ? (
            // The one running: progress bar and every recipe as it goes.
            <li key={j.id} data-testid="import-job" className="rounded-[16px] border border-ink bg-cream p-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[14px] font-semibold text-ink">
                  Tanda <span className="font-mono">{j.batch}</span>
                </p>
                <StatusChip job={j} />
              </div>
              <p className="mt-0.5 text-[12px] text-ink-muted">
                {j.fileName ?? "JSON pegado"} · {when(j.createdAt)}
              </p>
              <div
                role="progressbar"
                aria-label={`Importación de la tanda ${j.batch}`}
                aria-valuemin={0}
                aria-valuemax={j.total}
                aria-valuenow={j.done}
                className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-bone"
              >
                <div className="h-full rounded-full bg-ink transition-[width] duration-500" style={{ width: `${j.total > 0 ? Math.round((j.done / j.total) * 100) : 0}%` }} />
              </div>
              <p className="mt-1.5 text-[12px] text-ink-mid">{jobCounts(j)}</p>
              {j.outcomes.length > 0 && (
                <div className="mt-2">
                  <JobOutcomes job={j} />
                </div>
              )}
            </li>
          ) : (
            // Finished ones: one line; the detail opens on demand.
            <li key={j.id} data-testid="import-job" className="rounded-[14px] border border-border-soft bg-cream">
              <details>
                <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-[12px] text-ink-mid">
                  <span className="font-mono text-[13px] font-semibold text-ink">{j.batch}</span>
                  <StatusChip job={j} />
                  <span>{jobCounts(j)}</span>
                </summary>
                <div className="px-3 pb-3">
                  <p className="text-[12px] text-ink-muted">
                    {j.fileName ?? "JSON pegado"} · {when(j.createdAt)}
                  </p>
                  {j.error && <p className="mt-1 text-[12px] text-warn-text">{j.error}</p>}
                  {j.outcomes.length > 0 && (
                    <div className="mt-2">
                      <JobOutcomes job={j} />
                    </div>
                  )}
                </div>
              </details>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}
