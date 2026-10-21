"use client"

/**
 * /profile/ficha — «Tu ficha» (PRO-318, D-064, D-110): everything Mimoia
 * knows about the household, as its reader may see it (API: PRO-317,
 * specs/household-profile.md → «Tu ficha»). Design approved by Miguel on
 * 2026-10-21: https://claude.ai/artifact/9WPRprGUFk2gJQHKvJd6yY
 *
 *   - The portrait Mimo writes every night (or «Todavía os conozco poco»),
 *     the pending question, «Lo último que he aprendido».
 *   - Chips per person («La casa», «Tú», the other members, the people
 *     without an account): they switch the part below in place.
 *   - Facts by topic, each with where it comes from; a tap opens «¿Por qué lo
 *     sé?» (Así es · Corregir · Olvidar when the reader may change it).
 *   - The reader's own part: their health («Solo lo ves tú»), «Aprender de lo
 *     que hago», «Editar mis datos uno a uno» (/profile/memoria) and «Descargar
 *     mi ficha». A person without an account: Editar, Quitar de la casa.
 *   - A new household (no portrait, almost no facts) gets the short screen.
 */
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronRight, Plus } from "lucide-react"
import {
  FICHA_TOPIC_LABELS,
  type FichaChangeView,
  type FichaFactView,
  type FichaPersonView,
  type FichaQuestionView,
  type FichaView,
} from "@ona/shared"
import { ConfirmSheet } from "@/components/menu/MenuSheet"
import { useMimo } from "@/components/mimo/MimoProvider"
import { SubNotice } from "@/components/profile/SubPage"
import { SubLoadError, useQueryLoad } from "@/components/profile/SubLoadError"
import {
  FICHA_CARD,
  FICHA_EYEBROW,
  FICHA_PILL_INK,
  FICHA_PILL_OUTLINE,
  FICHA_TEXT_ACTION,
  FactList,
  FactRow,
  FichaAccent,
  FichaList,
  FichaSection,
  FichaShell,
  LinkRow,
  LockNote,
  OnlyYou,
  OriginBadge,
  useFichaToast,
} from "@/components/ficha/FichaUI"
import { CorrectSheet, PersonSheet, WhySheet } from "@/components/ficha/FichaSheets"
import { LearningSwitch } from "@/components/ficha/LearningSwitch"
import {
  FICHA_VIEW_KEY,
  downloadFicha,
  useAddPerson,
  useAnswerQuestion,
  useConfirmFact,
  useCorrectFact,
  useFicha,
  useForgetFact,
  useRemovePerson,
  useSetLearningPaused,
  useUpdatePerson,
} from "@/hooks/useFicha"
import {
  addDraftFor,
  ageBandLabel,
  byTopic,
  dayLabel,
  factsOf,
  forgetTitle,
  isMinorBand,
  isNewHousehold,
  isPhysicalFact,
  personInSentence,
  portraitUpdated,
  recentlyLearnt,
  toPerson,
  visibleQuestion,
} from "@/lib/ficha"
import type { ApiError } from "@/lib/api"

type Sheet =
  | { kind: "why"; fact: FichaFactView }
  | { kind: "correct"; fact: FichaFactView }
  | { kind: "forget"; fact: FichaFactView }
  | { kind: "person"; person: FichaPersonView | null }
  | { kind: "remove"; person: FichaPersonView }

const TITLE = (
  <>
    Así veo <FichaAccent>tu casa</FichaAccent>
  </>
)

export default function FichaPage() {
  const ficha = useFicha()
  const load = useQueryLoad([FICHA_VIEW_KEY, ficha])
  const status = (ficha.error as ApiError | null)?.status

  if (ficha.data) return <Ficha view={ficha.data} />

  return (
    <PageShell>
      {status === 403 || status === 404 ? (
        <SubNotice dashed>
          <p className="text-[15px] text-ink-mid">{(ficha.error as Error).message}</p>
        </SubNotice>
      ) : load.failed ? (
        <SubLoadError onRetry={load.retry} retrying={load.retrying} />
      ) : (
        <div className="flex animate-pulse flex-col gap-4" aria-hidden="true" data-testid="ficha-loading">
          <div className="h-48 rounded-[18px] bg-bone" />
          <div className="h-10 w-2/3 rounded-full bg-bone" />
          <div className="h-32 rounded-[18px] bg-bone" />
        </div>
      )}
    </PageShell>
  )
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <FichaShell back={{ href: "/profile", label: "Perfil" }} eyebrow="Tu ficha" title={TITLE}>
      {children}
    </FichaShell>
  )
}

function Ficha({ view }: { view: FichaView }) {
  const mimo = useMimo()
  const toast = useFichaToast()
  const viewer = view.people.find((p) => p.isViewer)
  const [selected, setSelected] = useState("casa")
  const [showAll, setShowAll] = useState(false)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [focusLearning, setFocusLearning] = useState(false)
  const forgetConfirmed = useRef(false)
  const learningRef = useRef<HTMLButtonElement>(null)

  const confirm = useConfirmFact()
  const correct = useCorrectFact()
  const forget = useForgetFact()
  const answer = useAnswerQuestion()
  const learning = useSetLearningPaused()
  const addPerson = useAddPerson()
  const updatePerson = useUpdatePerson()
  const removePerson = useRemovePerson()

  // The last fact / person a sheet showed: sheets stay mounted while they slide out.
  const lastFact = useRef<FichaFactView | null>(null)
  const lastPerson = useRef<{ person: FichaPersonView | null }>({ person: null })
  const lastRemoved = useRef<FichaPersonView | null>(null)
  if (sheet && (sheet.kind === "why" || sheet.kind === "correct" || sheet.kind === "forget")) lastFact.current = sheet.fact
  if (sheet?.kind === "person") lastPerson.current = { person: sheet.person }
  if (sheet?.kind === "remove") lastRemoved.current = sheet.person
  const sheetFact = lastFact.current
  const removing = lastRemoved.current

  const current = view.people.find((p) => p.key === selected) ?? view.people[0]
  const question = visibleQuestion(view)
  const isNew = !showAll && isNewHousehold(view)
  // Once the whole ficha is on screen it stays: forgetting a fact must not flip back to the short screen.
  const newNow = isNewHousehold(view)
  useEffect(() => {
    if (!newNow) setShowAll(true)
  }, [newNow])

  // «Pausar lo que aprendo de ti» → the reader's own part, on the switch.
  useEffect(() => {
    if (!focusLearning) return
    const el = learningRef.current
    if (!el) return
    el.scrollIntoView({ block: "center", behavior: "smooth" })
    el.focus({ preventScroll: true })
    setFocusLearning(false)
  }, [focusLearning, selected, showAll])

  function openSheet(next: Sheet | null) {
    setSheetError(null)
    setSheet(next)
  }
  const openFact = (fact: FichaFactView) => openSheet({ kind: "why", fact })
  const goToLearning = () => {
    if (viewer) setSelected(viewer.key)
    setShowAll(true)
    setFocusLearning(true)
  }
  const download = () => {
    downloadFicha().catch((e: Error) => toast.show(e.message || "No hemos podido descargar tu ficha."))
  }
  const ownerOf = (fact: FichaFactView) => view.people.find((p) => p.key === fact.subjectKey)?.label ?? null

  // The short screen lists everything in one list, except the reader's health: that keeps its «Solo lo ves tú».
  const newList = view.facts.filter((f) => !(f.health && f.subjectKey === viewer?.key))

  const howILearn = (
    <HowILearn
      newHousehold={isNew}
      paused={view.learningPaused}
      onLearning={goToLearning}
      onDownload={download}
    />
  )

  return (
    <PageShell>
      {view.portrait ? (
        <Portrait text={view.portrait.text} updatedAt={view.portrait.updatedAt} onTell={() => mimo.open({ draft: "En el retrato de mi casa hay algo que no cuadra: " })} />
      ) : (
        <StillNew onTell={() => mimo.open({ draft: "Te cuento cómo comemos en casa: " })} />
      )}

      {question && (
        <Question
          question={question}
          pending={answer.isPending}
          onAnswer={(a) =>
            answer.mutate(
              { questionId: question.id, answer: a },
              {
                onSuccess: () => toast.show(a === "later" ? "Te lo pregunto más adelante." : "Gracias, lo apunto."),
                onError: (e) => toast.show(e.message),
              },
            )
          }
        />
      )}

      {isNew ? (
        <>
          {newList.length > 0 && (
            <FichaSection
              title={newList.every((f) => f.origin === "alta") ? "Lo que me contaste al darte de alta" : "Lo que sé"}
              id="lo-que-se"
            >
              <FactList facts={newList} onOpen={openFact} />
            </FichaSection>
          )}
          <HealthSection facts={viewer ? factsOf(view, viewer.key).filter((f) => f.health) : []} onOpen={openFact} />
          {howILearn}
        </>
      ) : (
        <>
          <Recent recent={view.recent} facts={view.facts} onOpen={openFact} />

          <div role="group" aria-label="De quién" className="flex flex-wrap gap-2" data-testid="ficha-people">
            {view.people.map((p) => (
              <Chip key={p.key} pressed={p.key === current.key} onClick={() => setSelected(p.key)}>
                {p.label}
              </Chip>
            ))}
            <button
              type="button"
              aria-label="Añadir una persona de la casa"
              aria-haspopup="dialog"
              onClick={() => openSheet({ kind: "person", person: null })}
              className={`${CHIP} gap-1.5 border border-dashed border-ink-light px-3.5 text-ink-mid hover:border-ink hover:text-ink`}
            >
              <Plus size={14} strokeWidth={2} aria-hidden="true" />
              Persona
            </button>
          </div>

          <div className="flex flex-col gap-[26px]" data-testid="ficha-apartado" data-subject={current.key}>
            {current.kind === "household" && (
              <>
                <Topics facts={factsOf(view, "casa")} emptyText="Todavía no sé nada sobre la casa." onOpen={openFact} />
                <AddSomething onClick={() => mimo.open({ draft: addDraftFor(current) })} />
                {howILearn}
              </>
            )}
            {current.kind === "user" && current.isViewer && (
              <OwnPart
                facts={factsOf(view, current.key)}
                paused={view.learningPaused}
                learningPending={learning.isPending}
                learningRef={learningRef}
                onOpen={openFact}
                onToggleLearning={(paused) => learning.mutate(paused, { onError: (e) => toast.show(e.message) })}
                onDownload={download}
              />
            )}
            {current.kind === "user" && !current.isViewer && (
              <Topics facts={factsOf(view, current.key)} emptyText={`Todavía no sé nada sobre ${current.label}.`} onOpen={openFact} />
            )}
            {current.kind === "person" && (
              <PersonPart
                person={current}
                facts={factsOf(view, current.key)}
                onOpen={openFact}
                onEdit={() => openSheet({ kind: "person", person: current })}
                onRemove={() => openSheet({ kind: "remove", person: current })}
                onAdd={() => mimo.open({ draft: addDraftFor(current) })}
              />
            )}
          </div>
        </>
      )}

      {/* ── Sheets ── */}
      {sheetFact && (
        <>
          <WhySheet
            fact={sheetFact}
            open={sheet?.kind === "why"}
            onClose={() => openSheet(null)}
            confirming={confirm.isPending}
            error={sheet?.kind === "why" ? sheetError : null}
            ownerName={ownerOf(sheetFact)}
            onConfirm={() => {
              setSheetError(null)
              confirm.mutate(sheetFact.id, {
                onSuccess: () => {
                  openSheet(null)
                  toast.show("Gracias, lo dejo apuntado.")
                },
                onError: (e) => setSheetError(e.message),
              })
            }}
            onCorrect={() => openSheet({ kind: "correct", fact: sheetFact })}
            onForget={() => {
              forgetConfirmed.current = false
              openSheet({ kind: "forget", fact: sheetFact })
            }}
          />
          <CorrectSheet
            fact={sheetFact}
            open={sheet?.kind === "correct"}
            onClose={() => openSheet(null)}
            saving={correct.isPending}
            error={sheet?.kind === "correct" ? sheetError : null}
            onSave={({ text, validUntil }) => {
              setSheetError(null)
              correct.mutate(
                { factId: sheetFact.id, text, validUntil },
                {
                  onSuccess: (out) => {
                    openSheet(null)
                    toast.show(out.kind === "note" ? "Lo he apuntado con tus palabras, en «Otras notas»." : "Corregido.")
                  },
                  onError: (e) => setSheetError(e.message),
                },
              )
            }}
          />
          <ConfirmSheet
            open={sheet?.kind === "forget"}
            title={forgetTitle(sheetFact.sentence)}
            message="Lo borro de tu ficha y dejo de tenerlo en cuenta en el menú. Si más adelante vuelvo a verlo, te lo preguntaré antes de apuntarlo otra vez."
            confirmLabel="Olvidar"
            onConfirm={() => {
              forgetConfirmed.current = true
              forget.mutate(sheetFact.id, {
                onSuccess: () => toast.show("Olvidado."),
                onError: (e) => toast.show(e.message),
              })
            }}
            onClose={() => {
              // «Cancelar» goes back to «¿Por qué lo sé?»; «Olvidar» closes.
              openSheet(forgetConfirmed.current ? null : { kind: "why", fact: sheetFact })
              forgetConfirmed.current = false
            }}
          />
        </>
      )}

      <PersonSheet
        person={lastPerson.current.person}
        open={sheet?.kind === "person"}
        onClose={() => openSheet(null)}
        saving={addPerson.isPending || updatePerson.isPending}
        error={sheet?.kind === "person" ? sheetError : null}
        onSave={(input) => {
          if (sheet?.kind !== "person") return
          setSheetError(null)
          const editing = sheet.person
          if (editing) {
            updatePerson.mutate(
              { id: editing.key.slice(2), ...input },
              { onSuccess: () => openSheet(null), onError: (e) => setSheetError(e.message) },
            )
          } else {
            addPerson.mutate(input, {
              onSuccess: (out) => {
                setSelected(`p:${out.id}`)
                setShowAll(true)
                openSheet(null)
              },
              onError: (e) => setSheetError(e.message),
            })
          }
        }}
      />

      {removing && (
        <ConfirmSheet
          open={sheet?.kind === "remove"}
          title={`¿Quitar ${toPerson(removing.label)} de la casa?`}
          message="Se borra también lo que sé de esta persona."
          confirmLabel="Quitar de la casa"
          onConfirm={() =>
            removePerson.mutate(removing.key.slice(2), {
              onSuccess: () => setSelected("casa"),
              onError: (e) => toast.show(e.message),
            })
          }
          onClose={() => openSheet(null)}
        />
      )}

      {toast.node}
    </PageShell>
  )
}

/* ─────────────────────────── blocks ─────────────────────────── */

const CHIP =
  "relative inline-flex min-h-[40px] items-center rounded-full text-[14px] font-medium transition-colors after:absolute after:inset-x-0 after:inset-y-[-2px] after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`${CHIP} px-4 ${pressed ? "bg-ink text-cream" : "border border-border text-ink hover:border-ink"}`}
    >
      {children}
    </button>
  )
}

function Portrait({ text, updatedAt, onTell }: { text: string; updatedAt: string; onTell: () => void }) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  return (
    <section aria-label="Retrato" className={`${FICHA_CARD} flex flex-col gap-3.5 p-5`} data-testid="ficha-portrait">
      {paragraphs.map((p, i) => (
        <p key={i} className="text-[16px] leading-[1.6] text-ink">
          {p}
        </p>
      ))}
      <div className="flex flex-col gap-2.5 border-t border-border-soft pt-3">
        <span className="text-[13px] leading-[1.45] text-ink-soft">
          Lo escribo cada noche con lo que pasa en casa. Actualizado {portraitUpdated(updatedAt)}.
        </span>
        <button type="button" onClick={onTell} className={FICHA_TEXT_ACTION}>
          ¿Algo no cuadra? Dímelo
        </button>
      </div>
    </section>
  )
}

/** No portrait yet: «Todavía os conozco poco» and two ways to help. */
function StillNew({ onTell }: { onTell: () => void }) {
  return (
    <section aria-labelledby="todavia-titulo" className={`${FICHA_CARD} flex flex-col gap-3 p-5`} data-testid="ficha-new">
      <h2 id="todavia-titulo" className="font-serif-text text-[20px] font-[650] leading-[1.15] text-ink">
        Todavía os conozco poco
      </h2>
      <p className="text-[15.5px] leading-[1.55] text-ink-mid">
        Cada noche aprendo de lo que pasa en casa: lo que cambias del menú, lo que me cuentas y lo que marcas en la compra. En una o dos semanas aquí verás cómo coméis, contado por mí.
      </p>
      <p className="text-[15.5px] leading-[1.55] text-ink-mid">Si quieres que acierte antes:</p>
      <div className="flex flex-col gap-2 pt-0.5">
        <Link
          href="/afinar"
          className="flex flex-col gap-0.5 rounded-[10px] bg-ink px-4 py-3.5 text-cream transition-colors hover:bg-ink-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <span className="text-[15.5px] font-semibold">Afina tu menú</span>
          <span className="text-[13.5px] text-bone">Diez recetas, sí o no. Dos minutos.</span>
        </Link>
        <button
          type="button"
          onClick={onTell}
          className="flex flex-col gap-0.5 rounded-[10px] border border-ink px-4 py-3.5 text-left text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <span className="text-[15.5px] font-semibold">Cuéntale a Mimo cómo coméis</span>
          <span className="text-[13.5px] text-ink-mid">«Los viernes, pizza», «el pequeño no come pescado crudo»…</span>
        </button>
      </div>
    </section>
  )
}

function Question({
  question,
  pending,
  onAnswer,
}: {
  question: FichaQuestionView
  pending: boolean
  onAnswer: (answer: "yes" | "no" | "later") => void
}) {
  return (
    <section aria-labelledby="pregunta-titulo" className="flex flex-col gap-2.5 rounded-[18px] bg-bone px-[18px] pb-4 pt-[18px]" data-testid="ficha-question">
      <p className="text-[11.2px] font-medium uppercase tracking-[0.18em] text-ink-mid">Una pregunta</p>
      <h2 id="pregunta-titulo" className="font-serif-text text-[20px] font-[650] leading-[1.15] text-ink">
        {question.question}
      </h2>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" disabled={pending} onClick={() => onAnswer("yes")} className={FICHA_PILL_INK}>
          Sí
        </button>
        <button type="button" disabled={pending} onClick={() => onAnswer("no")} className={FICHA_PILL_OUTLINE}>
          No
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onAnswer("later")}
          className="inline-flex min-h-[44px] items-center rounded-full px-3 text-[14px] font-medium text-ink-mid transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40"
        >
          Ahora no
        </button>
      </div>
    </section>
  )
}

/** «Lo último que he aprendido» + «Ver todo lo que ha cambiado». */
function Recent({ recent, facts, onOpen }: { recent: FichaChangeView[]; facts: FichaFactView[]; onOpen: (f: FichaFactView) => void }) {
  const learnt = recentlyLearnt(recent)
  if (!learnt.length) return null
  return (
    <FichaSection title="Lo último que he aprendido" id="lo-ultimo">
      <FichaList>
        {learnt.map((c) => {
          // The row opens the fact the change was about, while it is still in the ficha.
          const fact = c.factId ? facts.find((f) => f.id === c.factId) : undefined
          const body = (
            <>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[12.5px] text-ink-soft">{dayLabel(c.at)}</span>
                <span className="text-[15.5px] leading-[1.4] text-ink [overflow-wrap:anywhere]">{c.sentence}</span>
              </span>
              {fact ? (
                <OriginBadge origin={fact.origin} label={fact.originLabel} />
              ) : (
                <OriginBadge origin={c.byMimo ? "mimo" : "otro"} label={c.byMimo ? "Lo he deducido" : c.verb} />
              )}
            </>
          )
          return (
            <li key={c.id}>
              {fact ? (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => onOpen(fact)}
                  className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cream/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
                >
                  {body}
                </button>
              ) : (
                <div className="flex min-h-[64px] items-center gap-3 px-4 py-3">{body}</div>
              )}
            </li>
          )
        })}
        <li>
          <Link
            href="/profile/ficha/historial"
            className="flex min-h-[48px] items-center justify-between px-4 text-[14px] font-medium text-terracotta-deep transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
          >
            Ver todo lo que ha cambiado
            <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </li>
      </FichaList>
    </FichaSection>
  )
}

/** Facts by topic (empty topics don't show); a line when there is nothing. */
function Topics({ facts, emptyText, onOpen }: { facts: FichaFactView[]; emptyText: string; onOpen: (f: FichaFactView) => void }) {
  const groups = byTopic(facts)
  if (!groups.length) return <p className="text-[14.5px] leading-[1.55] text-ink-muted">{emptyText}</p>
  return (
    <>
      {groups.map((g) => (
        <FichaSection key={g.topic} title={FICHA_TOPIC_LABELS[g.topic]} id={`tema-${g.topic}`}>
          <FactList facts={g.facts} onOpen={onOpen} />
        </FichaSection>
      ))}
    </>
  )
}

function AddSomething({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-1 rounded-[18px] border border-ink px-[18px] py-4 text-left text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <span className="text-[15.5px] font-semibold">Añadir algo que deba saber</span>
      <span className="text-[14px] leading-[1.45] text-ink-mid">Cuéntaselo a Mimo como se lo dirías a alguien de casa y lo apunto aquí.</span>
    </button>
  )
}

function HowILearn({
  newHousehold,
  paused,
  onLearning,
  onDownload,
}: {
  newHousehold: boolean
  paused: boolean
  onLearning: () => void
  onDownload: () => void
}) {
  return (
    <section aria-labelledby="como-aprendo-titulo" className="flex flex-col gap-3 border-t border-border pt-5" data-testid="ficha-how">
      <h2 id="como-aprendo-titulo" className={FICHA_EYEBROW}>
        Cómo aprendo
      </h2>
      <p className="text-[14.5px] leading-[1.55] text-ink-mid">
        {newHousehold
          ? "Lo que tú dices manda siempre sobre lo que yo deduzco. De salud nunca deduzco nada. Puedes corregir u olvidar cualquier cosa, y pausar lo que aprendo de ti."
          : "Cada noche miro lo que cambias del menú, lo que me cuentas por aquí o por WhatsApp y lo que marcas en la compra, y apunto lo que veo, con sus pruebas. Lo que tú dices manda siempre sobre lo que yo deduzco. De salud nunca deduzco nada."}
      </p>
      <div className="flex flex-col">
        <button type="button" onClick={onLearning} className={FICHA_TEXT_ACTION}>
          {paused ? "Reanudar lo que aprendo de ti" : "Pausar lo que aprendo de ti"}
        </button>
        <button type="button" onClick={onDownload} className={FICHA_TEXT_ACTION}>
          Descargar mi ficha
        </button>
      </div>
    </section>
  )
}

/** «Tú»: the reader's facts, their health («Solo lo ves tú»), the learning switch, the old editors and the export. */
function OwnPart({
  facts,
  paused,
  learningPending,
  learningRef,
  onOpen,
  onToggleLearning,
  onDownload,
}: {
  facts: FichaFactView[]
  paused: boolean
  learningPending: boolean
  learningRef: React.RefObject<HTMLButtonElement | null>
  onOpen: (f: FichaFactView) => void
  onToggleLearning: (paused: boolean) => void
  onDownload: () => void
}) {
  const general = facts.filter((f) => !f.health)
  const health = facts.filter((f) => f.health)
  const groups = byTopic(general)
  const learningOn = learningPending ? paused : !paused // optimistic while saving

  return (
    <>
      {groups.length === 0 && health.length === 0 && (
        <p className="text-[14.5px] leading-[1.55] text-ink-muted">Todavía no sé nada sobre ti.</p>
      )}
      {groups.map((g) => (
        <FichaSection key={g.topic} title={FICHA_TOPIC_LABELS[g.topic]} id={`tema-${g.topic}`}>
          <FichaList>
            {g.facts.map((f) => (
              <li key={f.id}>
                {f.type === "nutrition_principles" ? (
                  <LinkRow href="/profile/creencias" title={f.sentence} hint="Ver tus creencias" hintAccent />
                ) : (
                  <FactRow fact={f} onOpen={onOpen} />
                )}
              </li>
            ))}
          </FichaList>
        </FichaSection>
      ))}

      <HealthSection facts={health} onOpen={onOpen} />

      <LearningSwitch on={learningOn} pending={learningPending} onToggle={onToggleLearning} switchRef={learningRef} />

      <div className="-mt-3 flex flex-col">
        <Link href="/profile/memoria" className={FICHA_TEXT_ACTION}>
          Editar mis datos uno a uno
        </Link>
        <button type="button" onClick={onDownload} className={FICHA_TEXT_ACTION}>
          Descargar mi ficha
        </button>
      </div>
    </>
  )
}

/**
 * The reader's health, only in their own part: «Solo lo ves tú». Body data
 * (`physical.*`) isn't listed: one «Datos físicos» row leads to Perfil, where
 * it is edited. Nothing when there is no health fact.
 */
function HealthSection({ facts, onOpen }: { facts: FichaFactView[]; onOpen: (f: FichaFactView) => void }) {
  if (!facts.length) return null
  return (
    <FichaSection title="Salud" id="salud" aside={<OnlyYou />}>
      <FichaList>
        {facts
          .filter((f) => !isPhysicalFact(f))
          .map((f) => (
            <li key={f.id}>
              <FactRow fact={f} onOpen={onOpen} />
            </li>
          ))}
        <li>
          <LinkRow href="/profile#datos-fisicos" title="Datos físicos" hint="Edad, altura, peso y actividad, en Perfil" />
        </li>
      </FichaList>
      <p className="text-[13.5px] leading-[1.5] text-ink-muted">
        Aquí solo está lo que tú me has dicho, con tu permiso. Nadie más de la casa lo ve. El menú lo respeta y, como mucho, dice «alguien en casa no toma lactosa».
      </p>
    </FichaSection>
  )
}

/** A person without an account: who they are, what Mimo knows, Editar / Quitar de la casa. */
function PersonPart({
  person,
  facts,
  onOpen,
  onEdit,
  onRemove,
  onAdd,
}: {
  person: FichaPersonView
  facts: FichaFactView[]
  onOpen: (f: FichaFactView) => void
  onEdit: () => void
  onRemove: () => void
  onAdd: () => void
}) {
  const general = facts.filter((f) => !f.health)
  const health = facts.filter((f) => f.health)
  return (
    <>
      <section aria-label="Quién es" className={`${FICHA_CARD} flex items-center gap-3.5 p-4`} data-testid="ficha-person">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="font-serif-text text-[20px] font-[650] leading-tight text-ink [overflow-wrap:anywhere]">{person.label}</h2>
          <p className="text-[14px] text-ink-mid">
            {[ageBandLabel(person.ageBand), "sin cuenta en Mimoia"].filter(Boolean).join(" · ")}
          </p>
        </div>
        {person.canEdit && (
          <button type="button" onClick={onEdit} aria-haspopup="dialog" className={`${FICHA_PILL_OUTLINE} shrink-0 px-4`}>
            Editar
          </button>
        )}
      </section>

      {general.length > 0 ? (
        <FichaSection title="Lo que sé" id="lo-que-se-persona">
          <FactList facts={general} onOpen={onOpen} label={`Lo que sé sobre ${personInSentence(person)}`} />
        </FichaSection>
      ) : (
        <>
          <p className="text-[14.5px] leading-[1.55] text-ink-muted">Todavía no sé nada sobre {personInSentence(person)}.</p>
          {person.canEdit && <AddSomething onClick={onAdd} />}
        </>
      )}

      {health.length > 0 && (
        <FichaSection title="Salud" id="salud-persona">
          <FactList facts={health} onOpen={onOpen} />
        </FichaSection>
      )}

      {isMinorBand(person.ageBand) && (
        <LockNote>
          De los menores solo guardo un apodo («el pequeño», «la mayor», «hija 2») y la edad aproximada. Nunca su nombre.
        </LockNote>
      )}

      {person.canEdit && (
        <button
          type="button"
          onClick={onRemove}
          aria-haspopup="dialog"
          className="-mt-2 inline-flex min-h-[44px] items-center self-start rounded-md text-[14px] font-medium text-terracotta-deep transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          Quitar de la casa
        </button>
      )}
    </>
  )
}
