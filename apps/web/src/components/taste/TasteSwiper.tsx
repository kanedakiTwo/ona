"use client"

/**
 * «Afina tu menú» (PRO-146, specs/taste.md; design approved by Miguel on
 * 2026-10-16, artboard «Afina tu menú · prototipo»): intro «Dime qué te
 * apetece.», one card at a time (drag right «Me apetece», left «No para mí»,
 * up «Me encanta», with stamps while dragging — and buttons for the same,
 * plus «No la conozco · saltar»), «¿Qué es lo que no?» with the first «No
 * para mí» and then every 2, and the summary «Tu menú ya te conoce un poco
 * más».
 *
 * `mode="page"` is /afinar: batches of 10 («3 de 10»), the next one asked
 * in the background at card 5; after each 10 the summary, with «Seguir con
 * 10 más» (PRO-200). `mode="onboarding"` is the sign-up step: 10 cards,
 * «Saltar» always visible, then `onDone`.
 *
 * The session adapts: after 3 «No para mí» to meat (or fish) it stops
 * showing that group and flags it for the profile («¿No coméis carne?»).
 * A «No para mí» answered «Es muy largo» doesn't count for that (PRO-200).
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import {
  TASTE_BATCH_SIZE,
  TASTE_PREFETCH_AT,
  TASTE_PROTEIN_STREAK,
  TASTE_WHY_EVERY,
  type TasteCard,
  type TasteProteinGroup,
  type TasteReason,
  type TasteVerdict,
  prettyName,
} from "@ona/shared"
import { fetchTasteNext, postTasteFlag, postTasteVerdict } from "@/hooks/useTaste"
import { dislikeChipText, nextStreak } from "@/lib/tasteText"
import { useQueryClient } from "@tanstack/react-query"

type Screen = "intro" | "loading" | "cards" | "why" | "done"

interface Answer {
  card: TasteCard
  verdict: TasteVerdict
}

const EYEBROW = "m-0 text-[11.2px] font-medium uppercase tracking-[0.18em] text-ink-muted"
const PILL = "min-h-[52px] w-full rounded-full bg-ink text-[16px] font-medium text-cream transition-colors hover:bg-ink-mid active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
const CHIP = "min-h-[44px] rounded-full border border-border bg-cream px-4 text-[14px] text-ink transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-ink"

function IconCheck({ color = "currentColor", size = 18, width = 2 }: { color?: string; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}
function IconX({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1a1612" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
function IconHeart({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#c65d38" strokeWidth={2} strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z" />
    </svg>
  )
}

/** The «Dime qué te apetece.» screen (also reused by the sign-up step). */
export function TasteIntro({ onStart, onSkip, startLabel = "Empezar" }: { onStart: () => void; onSkip?: () => void; startLabel?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-6 px-6 pt-14 pb-8">
      <p className={EYEBROW}>Afina tu menú</p>
      <h1 className="m-0 font-display text-[44px] font-normal leading-[0.98] tracking-[-0.025em] text-ink">
        Dime qué te <span className="font-italic italic text-terracotta">apetece.</span>
      </h1>
      <p className="m-0 text-[16px] leading-[1.5] text-ink-mid">
        {onSkip
          ? "Son 10 platos: dime si te apetecen. Así tu menú empieza a parecerse a tu casa, y después te hago unas preguntas."
          : "Te enseño recetas de 10 en 10. Tú solo dices si te apetece o no, y tu menú empieza a parecerse a tu casa. Para cuando quieras."}
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 rounded-[18px] border border-border-soft bg-paper p-[18px]">
        <li className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-deep"><IconCheck color="#1a1612" /></span>
          <span className="text-[14px] leading-[1.45]"><b className="font-semibold">Me apetece:</b> desliza a la derecha</span>
        </li>
        <li className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-deep"><IconX /></span>
          <span className="text-[14px] leading-[1.45]"><b className="font-semibold">No para mí:</b> desliza a la izquierda</span>
        </li>
        <li className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-deep"><IconHeart /></span>
          <span className="text-[14px] leading-[1.45]"><b className="font-semibold">Me encanta:</b> desliza hacia arriba</span>
        </li>
      </ul>
      <div className="flex-1" />
      <button type="button" onClick={onStart} className={PILL}>{startLabel}</button>
      {onSkip ? (
        <button type="button" onClick={onSkip} className="min-h-[44px] text-[14px] font-medium text-ink-mid">Saltar</button>
      ) : (
        <p className="m-0 text-center text-[14px] text-ink-muted">Puedes parar cuando quieras: lo guardo todo.</p>
      )}
    </div>
  )
}

export function TasteSwiper({
  mode,
  onDone,
  onViewMenu,
  startAtCards = false,
}: {
  mode: "page" | "onboarding"
  /** Onboarding: after the 10 cards or «Saltar». */
  onDone?: () => void
  /** Page: «Ver mi menú». */
  onViewMenu?: () => void
  /** Skip the intro (e.g. arriving from «Empezar» on the menu). */
  startAtCards?: boolean
}) {
  const qc = useQueryClient()
  const [screen, setScreen] = useState<Screen>(startAtCards ? "loading" : "intro")
  const [queue, setQueue] = useState<TasteCard[]>([])
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [avoid, setAvoid] = useState<TasteProteinGroup[]>([])
  const [avoidIngredients, setAvoidIngredients] = useState<string[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [whyText, setWhyText] = useState("")
  /** Answers given before the current batch of 10 (page mode). */
  const [batchFrom, setBatchFrom] = useState(0)
  /** Card to resume on from the summary («Seguir con 10 más»). */
  const [resumeAt, setResumeAt] = useState(0)
  const [drag, setDrag] = useState<{ dx: number; dy: number; active: boolean }>({ dx: 0, dy: 0, active: false })
  const start = useRef<{ x: number; y: number } | null>(null)
  const nopes = useRef(0)
  const streak = useRef<Record<TasteProteinGroup, number>>({ carne: 0, pescado: 0 })
  const prefetch = useRef<Promise<TasteCard[]> | null>(null)
  const prefetchedFor = useRef(-1)
  const [error, setError] = useState("")

  const limitTotal = mode === "onboarding" ? TASTE_BATCH_SIZE : Infinity
  const card = queue[idx]
  const next = queue[idx + 1]

  const load = useCallback(
    async (opts: { exclude: string[]; avoid: TasteProteinGroup[]; limit?: number }) => {
      const res = await fetchTasteNext({ limit: opts.limit ?? TASTE_BATCH_SIZE, exclude: opts.exclude, avoid: opts.avoid })
      return res.cards
    },
    [],
  )

  const begin = useCallback(async () => {
    setScreen("loading")
    setError("")
    try {
      const cards = await load({ exclude: [], avoid })
      setQueue(cards)
      setIdx(0)
      setScreen(cards.length ? "cards" : "done")
    } catch {
      setError("No he podido cargar las recetas. Prueba otra vez en un momento.")
      setScreen("intro")
    }
  }, [avoid, load])

  useEffect(() => {
    if (startAtCards) void begin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Page mode: at card 5 of each batch, ask for the next batch in the background.
  useEffect(() => {
    if (mode !== "page" || screen !== "cards") return
    const batchStart = Math.floor(idx / TASTE_BATCH_SIZE) * TASTE_BATCH_SIZE
    if (idx - batchStart + 1 < TASTE_PREFETCH_AT || prefetchedFor.current >= batchStart) return
    prefetchedFor.current = batchStart
    const exclude = queue.map((c) => c.recipeId)
    prefetch.current = load({ exclude, avoid }).catch(() => [])
  }, [mode, screen, idx, queue, avoid, load])

  /** End of the batch or «Ya está por hoy»: the summary (page) or on with the sign-up. `resume` = the card to go on from. */
  const finish = useCallback((resume?: number) => {
    qc.invalidateQueries({ queryKey: ["taste"] })
    qc.invalidateQueries({ queryKey: ["memory"] })
    if (mode === "onboarding") return onDone?.()
    setResumeAt(resume ?? idx)
    setScreen("done")
  }, [idx, mode, onDone, qc])

  /** The prefetched batch (or a fresh one), minus what's already queued or avoided. */
  const fetchMore = useCallback(
    async (q: TasteCard[]) => {
      const exclude = q.map((c) => c.recipeId)
      let more = prefetch.current ? await prefetch.current : []
      prefetch.current = null
      more = more.filter((c) => !exclude.includes(c.recipeId) && !(c.protein && avoid.includes(c.protein)))
      if (more.length === 0) more = await load({ exclude, avoid }).catch(() => [])
      return more
    },
    [avoid, load],
  )

  /** Move to the next card (fetching more when the queue runs out). */
  const advance = useCallback(
    async (answered: number, q: TasteCard[] = queue) => {
      setDrag({ dx: 0, dy: 0, active: false })
      const i = idx + 1
      if (answered >= limitTotal) return finish(i)
      // Page mode: each 10 ends in the summary (PRO-200).
      if (mode === "page" && answered - batchFrom >= TASTE_BATCH_SIZE) return finish(i)
      if (i < q.length) {
        setIdx(i)
        setScreen("cards")
        return
      }
      if (mode === "onboarding") return finish()
      setScreen("loading")
      const more = await fetchMore(q)
      if (more.length === 0) return finish(i)
      setQueue([...q, ...more])
      setIdx(i)
      setScreen("cards")
    },
    [batchFrom, fetchMore, finish, idx, limitTotal, mode, queue],
  )

  /** «Seguir con 10 más» when the queue ran out right at the summary. */
  const continueAfter = useCallback(async () => {
    setScreen("loading")
    const more = await fetchMore(queue)
    if (more.length === 0) return setScreen("done")
    setQueue([...queue, ...more])
    setIdx(queue.length)
    setScreen("cards")
  }, [fetchMore, queue])

  /** 3 «No para mí» to one protein group: stop showing it this session and flag it. */
  const adaptTo = useCallback(
    async (group: TasteProteinGroup, answeredCount: number) => {
      const nextAvoid = [...avoid, group]
      setAvoid(nextAvoid)
      postTasteFlag(group).catch(() => {})
      const kept = queue.filter((c, i) => i <= idx || c.protein !== group)
      const dropped = queue.length - kept.length
      let q = kept
      if (dropped > 0) {
        const need = mode === "onboarding" ? Math.max(0, limitTotal - answeredCount - (kept.length - idx - 1)) : dropped
        if (need > 0) {
          const extra = await load({ exclude: queue.map((c) => c.recipeId), avoid: nextAvoid, limit: need }).catch(() => [])
          q = [...kept, ...extra]
        }
        setQueue(q)
        prefetch.current = null
        prefetchedFor.current = -1
      }
      return q
    },
    [avoid, idx, limitTotal, load, mode, queue],
  )

  /** Meat/fish streak; 3 «No para mí» in a row → adapt. Returns the (maybe refilled) queue. */
  const countStreak = useCallback(
    async (c: TasteCard, verdict: TasteVerdict, reasonKind: TasteReason["kind"] | null, answeredCount: number) => {
      if (!c.protein) return queue
      streak.current[c.protein] = nextStreak(streak.current[c.protein], verdict, reasonKind)
      if (streak.current[c.protein] >= TASTE_PROTEIN_STREAK && !avoid.includes(c.protein)) return adaptTo(c.protein, answeredCount)
      return queue
    },
    [adaptTo, avoid, queue],
  )

  const decide = useCallback(
    async (verdict: TasteVerdict) => {
      if (!card) return
      postTasteVerdict(card.recipeId, verdict).catch(() => {})
      const nextAnswers = [...answers, { card, verdict }]
      setAnswers(nextAnswers)
      if (verdict === "nope") {
        nopes.current += 1
        if ((nopes.current - 1) % TASTE_WHY_EVERY === 0) {
          // The streak waits for the reason: «Es muy largo» doesn't count.
          setDrag({ dx: 0, dy: 0, active: false })
          setWhyText("")
          setScreen("why")
          return
        }
      }
      const q = await countStreak(card, verdict, null, nextAnswers.length)
      await advance(nextAnswers.length, q)
    },
    [advance, answers, card, countStreak],
  )

  const answerWhy = useCallback(
    async (reason: TasteReason | null) => {
      if (card && reason) {
        postTasteVerdict(card.recipeId, "nope", reason)
          .then(() => qc.invalidateQueries({ queryKey: ["memory"] }))
          .catch(() => {})
        if (reason.kind === "ingredient" && reason.text) setAvoidIngredients((a) => [...a, reason.text!])
        if (reason.kind === "other" && reason.text) setNotes((n) => [...n, `${card.name}: «${reason.text}»`])
      }
      const q = card ? await countStreak(card, "nope", reason?.kind ?? null, answers.length) : queue
      await advance(answers.length, q)
    },
    [advance, answers.length, card, countStreak, qc, queue],
  )

  // ─── Gestures ──────────────────────────────
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    start.current = { x: e.clientX, y: e.clientY }
    setDrag({ dx: 0, dy: 0, active: true })
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y, active: true })
  }
  const onPointerUp = () => {
    if (!start.current) return
    start.current = null
    const { dx, dy } = drag
    if (dx > 100) return void decide("like")
    if (dx < -100) return void decide("nope")
    if (dy < -110 && Math.abs(dx) < 60) return void decide("love")
    setDrag({ dx: 0, dy: 0, active: false })
  }

  const likeOp = Math.max(0, Math.min(1, drag.dx / 100))
  const nopeOp = Math.max(0, Math.min(1, -drag.dx / 100))
  const loveOp = Math.max(0, Math.min(1, -drag.dy / 100)) * (Math.abs(drag.dx) < 60 ? 1 : 0)
  // The counter counts the batch: «3 de 10» (PRO-200; before, «1 de 101» over the catalogue).
  const shownTotal = TASTE_BATCH_SIZE
  const position = Math.min(shownTotal, answers.length - (mode === "page" ? batchFrom : 0) + 1)
  const progress = shownTotal ? Math.min(100, (position / shownTotal) * 100) : 0

  if (screen === "intro") {
    return (
      <>
        {error && <p role="alert" className="mx-6 mt-6 rounded-2xl bg-warn-bg p-3 text-[14px] text-terracotta-deep">{error}</p>}
        <TasteIntro onStart={() => void begin()} onSkip={mode === "onboarding" ? onDone : undefined} />
      </>
    )
  }

  if (screen === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center" role="status">
        <p className="text-[14px] text-ink-muted">Buscando recetas…</p>
      </div>
    )
  }

  if (screen === "why" && card) {
    return (
      <div className="relative flex flex-1 flex-col">
        {card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.imageUrl} alt="" className="h-[360px] w-full object-cover opacity-35" />
        ) : (
          <div className="h-[360px] w-full bg-bone" />
        )}
        <section
          aria-labelledby="why-title"
          className="absolute inset-x-0 bottom-0 flex flex-col gap-4 rounded-t-[28px] border-t border-border-soft bg-paper px-5 pt-6 pb-7"
        >
          <div aria-hidden="true" className="h-1 w-10 self-center rounded-full bg-border" />
          <p className={EYEBROW}>{card.name}</p>
          <h2 id="why-title" className="m-0 font-display text-[26px] font-normal leading-[1.1] tracking-[-0.025em] text-ink">¿Qué es lo que no?</h2>
          <p className="m-0 text-[14px] leading-[1.45] text-ink-mid">Si es un ingrediente, lo quito también de otras recetas.</p>
          <div className="flex flex-wrap gap-2">
            {card.mainIngredients.map((ing) => (
              <button key={ing.name} type="button" className={CHIP} onClick={() => void answerWhy({ kind: "ingredient", text: ing.name })}>
                {dislikeChipText(ing.label)}
              </button>
            ))}
            <button type="button" className={CHIP} onClick={() => void answerWhy({ kind: "dish" })}>El plato en sí</button>
            <button type="button" className={CHIP} onClick={() => void answerWhy({ kind: "long" })}>Es muy largo</button>
          </div>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const t = whyText.trim()
              void answerWhy(t ? { kind: "other", text: t } : null)
            }}
          >
            <label htmlFor="why-other" className="text-[14px] font-medium text-ink">¿Es otra cosa? Cuéntamelo</label>
            <div className="flex gap-2">
              <input
                id="why-other"
                type="text"
                value={whyText}
                maxLength={280}
                onChange={(e) => setWhyText(e.target.value)}
                placeholder="Ej. «la como fuera, no en casa»"
                className="min-h-[44px] min-w-0 flex-1 rounded-[10px] border border-border bg-cream px-3.5 text-[15px] text-ink placeholder:text-ink-light focus:border-ink focus:outline-none"
              />
              <button type="submit" className="min-h-[44px] rounded-full bg-ink px-4 text-[14px] font-medium text-cream">Enviar</button>
            </div>
          </form>
          <button type="button" onClick={() => void answerWhy({ kind: "none" })} className="min-h-[44px] text-[14px] text-ink-muted">Prefiero no decirlo</button>
        </section>
      </div>
    )
  }

  if (screen === "done") {
    const love = answers.filter((a) => a.verdict === "love").map((a) => a.card.name)
    const like = answers.filter((a) => a.verdict === "like").map((a) => a.card.name)
    const nope = [
      ...answers.filter((a) => a.verdict === "nope").map((a) => a.card.name),
      ...avoidIngredients.map((i) => `todo lo que lleve ${prettyName(i)}`),
    ]
    // Only what was rated in this session, and only the rows that have something (PRO-200).
    const rows = [
      { title: "Saldrán más a menudo", items: love },
      { title: "Te apetecen", items: like },
      { title: "No volverán a salir", items: nope },
      ...(notes.length ? [{ title: "Lo que me has contado", items: notes, sep: " · " }] : []),
    ].filter((r) => r.items.length > 0)
    return (
      <div className="flex flex-1 flex-col gap-5 px-6 pt-14 pb-8">
        <p className={EYEBROW}>Apuntado</p>
        <h1 className="m-0 font-display text-[40px] font-normal leading-none tracking-[-0.025em] text-ink">
          Tu menú ya te <span className="font-italic italic text-terracotta">conoce</span> un poco más.
        </h1>
        {rows.length > 0 ? (
          <dl className="m-0 flex flex-col divide-y divide-border-soft rounded-[18px] border border-border-soft bg-paper" data-testid="taste-summary">
            {rows.map((r) => (
              <div key={r.title} className="flex flex-col gap-1 p-4">
                <dt className="text-[14px] font-semibold">{r.title}</dt>
                <dd className="m-0 text-[14px] leading-[1.45] text-ink-mid">{r.items.join(r.sep ?? ", ")}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="m-0 text-[16px] leading-[1.5] text-ink-mid" data-testid="taste-summary">
            En esta vuelta no has valorado ninguna receta. Lo que valoraste otros días sigue guardado.
          </p>
        )}
        <p className="m-0 text-[14px] leading-[1.45] text-ink-mid">
          Lo tienes todo en Perfil → Lo que recuerdo de ti, y lo puedes cambiar cuando quieras.
        </p>
        <div className="flex-1" />
        <button type="button" onClick={onViewMenu} className={PILL}>Ver mi menú</button>
        <button
          type="button"
          onClick={() => {
            setBatchFrom(answers.length)
            if (resumeAt < queue.length) {
              setIdx(resumeAt)
              setScreen("cards")
            } else {
              void continueAfter()
            }
          }}
          className="min-h-[44px] text-[14px] font-medium text-ink"
        >
          Seguir con 10 más
        </button>
      </div>
    )
  }

  if (!card) return null

  return (
    <div className="flex flex-1 flex-col gap-4 px-5 pt-5 pb-6">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => finish()} className="min-h-[44px] p-0 text-[14px] font-medium text-ink-mid">
          {mode === "onboarding" ? "Saltar" : "Ya está por hoy"}
        </button>
        <span className="text-[14px] text-ink-muted" data-testid="taste-counter">
          {position} de {shownTotal}
        </span>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-bone"
        role="progressbar"
        aria-label="Recetas valoradas"
        aria-valuemin={0}
        aria-valuemax={shownTotal}
        aria-valuenow={position}
      >
        <div className="h-1 rounded-full bg-terracotta" style={{ width: `${progress}%` }} />
      </div>

      <div className="relative min-h-[360px] flex-1">
        {next && (
          <div aria-hidden="true" className="absolute inset-x-[10px] top-[14px] bottom-0 scale-95 overflow-hidden rounded-[18px] border border-border-soft bg-paper">
            {next.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={next.imageUrl} alt="" className="h-full w-full object-cover opacity-55" />
            )}
          </div>
        )}
        <div
          key={card.recipeId}
          data-testid="taste-card"
          aria-live="polite"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden rounded-[18px] border border-border-soft bg-paper"
          style={{
            transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(${drag.dx / 18}deg)`,
            transition: drag.active ? "none" : "transform 180ms ease-out",
          }}
        >
          {card.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.imageUrl} alt={card.name} draggable={false} className="pointer-events-none block h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-bone" />
          )}
          <div aria-hidden="true" className="absolute top-5 left-[18px] -rotate-[8deg] rounded-[10px] border-2 border-forest bg-paper px-3 py-1.5 text-[14px] font-semibold tracking-[0.08em] text-forest" style={{ opacity: likeOp }}>
            ME APETECE
          </div>
          <div aria-hidden="true" className="absolute top-5 right-[18px] rotate-[8deg] rounded-[10px] border-2 border-ink bg-paper px-3 py-1.5 text-[14px] font-semibold tracking-[0.08em] text-ink" style={{ opacity: nopeOp }}>
            NO PARA MÍ
          </div>
          <div aria-hidden="true" className="absolute top-5 left-1/2 -ml-16 w-32 rounded-[10px] border-2 border-terracotta-deep bg-paper py-1.5 text-center text-[14px] font-semibold tracking-[0.08em] text-terracotta-deep" style={{ opacity: loveOp }}>
            ME ENCANTA
          </div>
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-col gap-1 rounded-[14px] bg-paper px-4 py-3.5">
            <span className="text-[11.2px] font-medium uppercase tracking-[0.18em] text-terracotta-deep">{card.meta}</span>
            <h2 className="m-0 font-display text-[24px] font-[650] leading-[1.12] tracking-[-0.01em] text-ink">{card.name}</h2>
          </div>
        </div>
      </div>

      {/* Each button says what it does (PRO-200: ✕ ♥ ✓ alone weren't clear). */}
      <div className="flex items-start justify-center gap-5">
        <button type="button" onClick={() => void decide("nope")} aria-label="No para mí" className="group flex w-20 flex-col items-center gap-1.5 focus-visible:outline-none">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-paper group-focus-visible:outline-2 group-focus-visible:outline-ink">
            <IconX size={26} />
          </span>
          <span aria-hidden="true" className="text-[13px] font-medium text-ink-mid">No</span>
        </button>
        <button type="button" onClick={() => void decide("love")} aria-label="Me encanta" className="group flex w-20 flex-col items-center gap-1.5 pt-1.5 focus-visible:outline-none">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full border border-border bg-paper group-focus-visible:outline-2 group-focus-visible:outline-ink">
            <IconHeart size={22} />
          </span>
          <span aria-hidden="true" className="text-[13px] font-medium text-terracotta-deep">Me encanta</span>
        </button>
        <button type="button" onClick={() => void decide("like")} aria-label="Me apetece" className="group flex w-20 flex-col items-center gap-1.5 focus-visible:outline-none">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ink group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ink">
            <IconCheck color="#faf6ee" size={26} width={2.2} />
          </span>
          <span aria-hidden="true" className="text-[13px] font-medium text-ink">Me apetece</span>
        </button>
      </div>
      <button type="button" onClick={() => void decide("skip")} className="min-h-[44px] text-[14px] text-ink-muted underline underline-offset-[3px]">
        No la conozco · saltar
      </button>
    </div>
  )
}
