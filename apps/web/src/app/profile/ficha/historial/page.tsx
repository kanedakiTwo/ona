"use client"

/**
 * /profile/ficha/historial — «Lo que ha cambiado» (PRO-318): the ficha's
 * history of the last 60 days the reader may see, grouped by day («Anoche»,
 * «Hace 3 días»…), with «Deshacer» on what Mimo did (`canUndo`), and
 * «Descargar mi ficha». API: `GET /household/profile/changes`,
 * `POST …/changes/:id/undo` (specs/household-profile.md → «Tu ficha»).
 */
import { useState } from "react"
import { SubLoadError, useQueryLoad } from "@/components/profile/SubLoadError"
import {
  FICHA_CARD,
  FICHA_EYEBROW,
  FichaAccent,
  FichaShell,
  useFichaToast,
} from "@/components/ficha/FichaUI"
import { downloadFicha, useFichaChanges, useUndoChange } from "@/hooks/useFicha"
import { groupChangesByDay } from "@/lib/ficha"

const DAYS = 60

export default function FichaHistoryPage() {
  const changes = useFichaChanges(DAYS)
  const load = useQueryLoad([["ficha", "changes", DAYS], changes])
  const undo = useUndoChange()
  const toast = useFichaToast()
  const [undone, setUndone] = useState<Set<string>>(() => new Set())
  const [downloading, setDownloading] = useState(false)

  const groups = changes.data ? groupChangesByDay(changes.data) : []

  function doUndo(id: string) {
    undo.mutate(id, {
      onSuccess: () => {
        setUndone((prev) => new Set(prev).add(id))
        toast.show("Deshecho.")
      },
      // 409: the fact moved on since Mimo's change; the button goes and the list refreshes.
      onError: (e) => {
        setUndone((prev) => new Set(prev).add(id))
        toast.show(e.message)
      },
    })
  }

  async function download() {
    setDownloading(true)
    try {
      await downloadFicha()
    } catch (e) {
      toast.show((e as Error).message || "No hemos podido descargar tu ficha.")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <FichaShell
      back={{ href: "/profile/ficha", label: "Tu ficha" }}
      eyebrow="Tu ficha"
      title={
        <>
          Lo que ha <FichaAccent>cambiado</FichaAccent>
        </>
      }
    >
      {changes.data ? (
        groups.length === 0 ? (
          <p className="text-[14.5px] leading-[1.55] text-ink-muted">En los últimos dos meses no ha cambiado nada.</p>
        ) : (
          groups.map((g, gi) => (
            <section key={`${g.label}-${gi}`} aria-labelledby={`dia-${gi}`} className="flex flex-col gap-2.5" data-testid="ficha-history-day">
              <h2 id={`dia-${gi}`} className={FICHA_EYEBROW}>
                {g.label}
              </h2>
              <ul className={`${FICHA_CARD} divide-y divide-border-soft overflow-hidden`}>
                {g.changes.map((c) => {
                  const isUndone = undone.has(c.id)
                  return (
                    <li key={c.id} className="flex min-h-[60px] items-center gap-3 px-4 py-3" data-testid="ficha-change">
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-[13px] text-ink-soft">{c.verb}</span>
                        <span className="text-[15.5px] leading-[1.4] text-ink [overflow-wrap:anywhere]">{c.sentence}</span>
                      </div>
                      {c.canUndo &&
                        (isUndone ? (
                          <span className="shrink-0 text-[13.5px] text-ink-muted">Deshecho</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => doUndo(c.id)}
                            disabled={undo.isPending && undo.variables === c.id}
                            aria-label={`Deshacer: ${c.verb} «${c.sentence}»`}
                            className="relative inline-flex min-h-[40px] shrink-0 items-center rounded-full border border-border px-3.5 text-[13.5px] font-medium text-ink transition-colors after:absolute after:inset-x-0 after:inset-y-[-2px] after:content-[''] hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
                          >
                            Deshacer
                          </button>
                        ))}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )
      ) : load.failed ? (
        <SubLoadError onRetry={load.retry} retrying={load.retrying} />
      ) : (
        <div className="flex animate-pulse flex-col gap-4" aria-hidden="true">
          <div className="h-4 w-24 rounded-full bg-bone" />
          <div className="h-32 rounded-[18px] bg-bone" />
        </div>
      )}

      <section aria-labelledby="descargar-titulo" className="flex flex-col gap-2.5 border-t border-border pt-5">
        <h2 id="descargar-titulo" className="font-serif-text text-[20px] font-[650] leading-[1.15] text-ink">
          Descargar mi ficha
        </h2>
        <p className="text-[14.5px] leading-[1.55] text-ink-mid">
          Todo lo que sé de ti y de tu casa, con sus pruebas, sus fechas y de dónde sale cada cosa, en un archivo. Lo que es salud de otra persona de la casa no va en el tuyo.
        </p>
        <button
          type="button"
          onClick={() => void download()}
          disabled={downloading}
          className="inline-flex min-h-[48px] items-center self-start rounded-full bg-ink px-5 text-[15px] font-medium text-cream transition-colors hover:bg-ink-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
        >
          {downloading ? "Descargando…" : "Descargar"}
        </button>
      </section>

      {toast.node}
    </FichaShell>
  )
}
