"use client"

/**
 * /profile/quien/[id] — one person of «Quién come» (PRO-1203).
 *
 *   - `me`: your allergies and diet (what the menu reads for you; changed in
 *     «Tus alergias y tu dieta», the same screen as after an invitation), what
 *     you don't like (Mimo's memory, which the menu reads) and, only with the
 *     health-data consent, your body data and your goal.
 *   - another member with an account: their allergies are theirs (art. 9):
 *     only whether they've told us; what they don't like, to read.
 *   - a person without an account: name or alias and age, their allergies and
 *     diet (health data: with your consent) and what they don't like — the
 *     menu reads both — and «Quitar de la casa».
 */
import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronRight } from "lucide-react"
import { RESTRICTION_PRESETS, unionRestrictions } from "@ona/shared"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { ageBandPill } from "@/lib/ficha"
import { useDeleteMemoryFact, useUpdateMemory } from "@/hooks/useUserMemory"
import { useSchoolMenu } from "@/hooks/useSchoolMenu"
import {
  PEOPLE_KEY,
  useHouseholdPeople,
  useRemoveHouseholdPerson,
  useSetPersonList,
  useUpdateHouseholdPerson,
  type PersonRow,
} from "@/hooks/useHouseholdPeople"
import { PersonSheet } from "@/components/ficha/FichaSheets"
import { HealthConsentCheckbox } from "@/components/HealthConsentCheckbox"
import { HealthAndGoalCard } from "@/components/profile/HealthAndGoalCard"
import { ListEditor } from "@/components/profile/ListEditor"
import { personAgeLine } from "@/components/profile/WhoEatsSection"
import { PILL_OUTLINE, SUB_CARD, SubPage } from "@/components/profile/SubPage"

/** Mirrors `RestrictionReading` in apps/api/src/services/restrictionReader.ts. */
interface RestrictionReading {
  text: string
  restrictions: string[]
  understood: boolean
}

function Card({ title, hint, children, testId }: { title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className={`${SUB_CARD} p-4 lg:p-5`} data-testid={testId}>
      <h2 className="font-serif-text text-[18px] font-[650] text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function ReadChips({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <p className="text-[13px] italic text-ink-muted">{empty}</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((r) => (
        <span key={r} className="inline-flex h-9 items-center rounded-full bg-cream-deep px-3.5 text-[13px] text-ink">
          {r}
        </span>
      ))}
    </div>
  )
}

function SchoolRow() {
  const school = useSchoolMenu()
  if (!school.data?.visible) return null
  const connected = school.data.days.length > 0
  return (
    <Link
      href="/profile/casa/cole"
      className={`${SUB_CARD} flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 text-ink hover:bg-bone`}
    >
      <span>
        <span className="block text-[15px] font-medium">Menú del cole</span>
        <span className="block text-[13px] text-ink-muted">
          {connected ? "Conectado: la cena no repite lo de mediodía" : "Pásame el menú del comedor y la cena no repetirá lo de mediodía."}
        </span>
      </span>
      <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-muted" />
    </Link>
  )
}

function Me({ person }: { person: PersonRow }) {
  const qc = useQueryClient()
  const update = useUpdateMemory()
  const remove = useDeleteMemoryFact()
  const [error, setError] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: PEOPLE_KEY })
  return (
    <div className="grid gap-3 lg:grid-cols-2 lg:items-start lg:gap-4">
      <div className="grid gap-3 lg:gap-4">
        <Card title="Alergias y dieta" hint="El menú de la casa las tiene en cuenta para todos." testId="person-restrictions">
          <ReadChips items={person.restrictions ?? []} empty={person.answered ? "Ninguna" : "Aún no nos has dicho tus alergias ni tu dieta"} />
          <Link href="/profile/casa/alergias?next=/profile/quien/me" className={`${PILL_OUTLINE} mt-3`}>
            Cambiar alergias y dieta
          </Link>
        </Card>
        <Card title="Lo que no te gusta" hint="El menú lo evita; si lo pides tú, te lo damos." testId="person-dislikes">
          <ListEditor
            saved={person.dislikes ?? []}
            placeholder="Otra, p. ej. cilantro"
            addLabel="Otra cosa que no te gusta"
            emptyText="Nada apuntado"
            saving={update.isPending || remove.isPending}
            onSave={(values) => {
              setError(null)
              const done = { onSuccess: refresh, onError: () => setError("No hemos podido guardarlo. Inténtalo otra vez.") }
              if (values.length === 0) remove.mutate({ key: "dislikes" }, done)
              else update.mutate({ key: "dislikes", value: values }, done)
            }}
          />
          {error && <p role="alert" className="mt-2 text-[13px] text-terracotta-deep">{error}</p>}
        </Card>
      </div>
      <HealthAndGoalCard onConsentChange={() => void refresh()} />
    </div>
  )
}

function Member({ person }: { person: PersonRow }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2 lg:items-start lg:gap-4">
      <Card title="Alergias y dieta" testId="person-restrictions">
        <p className="text-[14px] leading-relaxed text-ink">
          {person.answered
            ? `${person.name} ya nos ha dicho sus alergias y su dieta, y el menú de la casa las tiene en cuenta.`
            : `${person.name} aún no nos ha dicho sus alergias ni su dieta, así que el menú no las tiene en cuenta.`}
        </p>
        <p className="mt-2 text-[13px] leading-snug text-ink-muted">
          Son datos de salud: solo los ve y los cambia {person.name}, desde su perfil.
        </p>
      </Card>
      {person.dislikes && (
        <Card title="Lo que no le gusta" hint={`Lo cambia ${person.name} desde su perfil.`} testId="person-dislikes">
          <ReadChips items={person.dislikes} empty="Nada apuntado" />
        </Card>
      )}
    </div>
  )
}

function Person({ person, healthConsent }: { person: PersonRow; healthConsent: boolean }) {
  const { user } = useAuth()
  const router = useRouter()
  const qc = useQueryClient()
  const setList = useSetPersonList()
  const updatePerson = useUpdateHouseholdPerson()
  const removePerson = useRemoveHouseholdPerson()
  const [editing, setEditing] = useState(false)
  const [sheetError, setSheetError] = useState<string | null>(null)
  const [error, setError] = useState<{ list: string; text: string } | null>(null)
  const [consentBusy, setConsentBusy] = useState(false)
  const [reading, setReading] = useState(false)

  async function grantConsent(next: boolean) {
    if (!user || !next) return
    setConsentBusy(true)
    try {
      await api.post(`/user/${user.id}/health-consent`, { consent: true })
      await qc.invalidateQueries({ queryKey: PEOPLE_KEY })
    } finally {
      setConsentBusy(false)
    }
  }

  async function saveRestrictions(values: string[]) {
    if (!user) return
    setError(null)
    // What is written by hand is read as Mimo reads it (PRO-347): «sin glutn» → «sin gluten».
    let final = values
    const free = values.filter((r) => !(RESTRICTION_PRESETS as readonly string[]).includes(r))
    if (free.length > 0) {
      setReading(true)
      try {
        const { readings } = await api.post<{ readings: RestrictionReading[] }>(`/user/${user.id}/restrictions/read`, { texts: free })
        const unclear = readings.filter((r) => !r.understood).map((r) => r.text)
        if (unclear.length > 0) {
          setError({
            list: "restrictions",
            text: `No hemos entendido ${unclear.map((t) => `«${t}»`).join(", ")}. Elígelo en la lista o escríbelo con otras palabras (p. ej. «sin gluten», «marisco»).`,
          })
          return
        }
        final = unionRestrictions(values.filter((r) => !free.includes(r)), readings.flatMap((r) => r.restrictions))
      } catch {
        setError({ list: "restrictions", text: "No hemos podido guardarlo. Inténtalo otra vez." })
        return
      } finally {
        setReading(false)
      }
    }
    setList.mutate(
      { id: person.id, list: "restrictions", values: final },
      { onError: (e) => setError({ list: "restrictions", text: e instanceof ApiError ? e.message : "No hemos podido guardarlo." }) },
    )
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2 lg:items-start lg:gap-4">
      <div className="grid gap-3 lg:gap-4">
        <Card
          title="Alergias y dieta"
          hint="El menú de la casa las tiene en cuenta para todos."
          testId="person-restrictions"
        >
          {!healthConsent && (
            <div className="mb-3">
              <p className="mb-2 text-[13px] leading-snug text-ink-muted">
                Son datos de salud: para apuntarlos necesitamos tu permiso.
              </p>
              <HealthConsentCheckbox checked={false} disabled={consentBusy} onChange={(v) => void grantConsent(v)} />
            </div>
          )}
          <ListEditor
            saved={person.restrictions ?? []}
            presets={RESTRICTION_PRESETS}
            placeholder="Otra, p. ej. pimiento"
            addLabel="Otra alergia o dieta"
            emptyText="Ninguna apuntada"
            disabled={!healthConsent}
            saving={reading || (setList.isPending && setList.variables?.list === "restrictions")}
            onSave={(values) => void saveRestrictions(values)}
          />
          {error?.list === "restrictions" && (
            <p role="alert" className="mt-2 text-[13px] text-terracotta-deep">{error.text}</p>
          )}
        </Card>
        <Card title="Lo que no le gusta" hint="El menú lo evita." testId="person-dislikes">
          <ListEditor
            saved={person.dislikes ?? []}
            placeholder="Otra, p. ej. cilantro"
            addLabel="Otra cosa que no le gusta"
            emptyText="Nada apuntado"
            saving={setList.isPending && setList.variables?.list === "dislikes"}
            onSave={(values) =>
              setList.mutate(
                { id: person.id, list: "dislikes", values },
                { onError: () => setError({ list: "dislikes", text: "No hemos podido guardarlo. Inténtalo otra vez." }) },
              )
            }
          />
          {error?.list === "dislikes" && <p role="alert" className="mt-2 text-[13px] text-terracotta-deep">{error.text}</p>}
        </Card>
      </div>
      <div className="grid gap-3 lg:gap-4">
        {person.group === "kid" && <SchoolRow />}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setSheetError(null); setEditing(true) }} className={PILL_OUTLINE}>
            Cambiar nombre o edad
          </button>
          <button
            type="button"
            disabled={removePerson.isPending}
            onClick={() => {
              if (!window.confirm(`¿Quitar a ${person.name} de la casa? Se borra lo que sabíamos de su comida.`)) return
              removePerson.mutate(person.id, { onSuccess: () => router.push("/profile") })
            }}
            className={PILL_OUTLINE}
          >
            Quitar de la casa
          </button>
        </div>
        <p className="text-[12.5px] leading-snug text-ink-muted">
          No usa Mimoia: lo que apuntas aquí lo ven los adultos de la casa. De los menores solo guardamos un apodo y la edad aproximada.
        </p>
      </div>
      <PersonSheet
        person={{ key: person.id, label: person.name, ageBand: person.ageBand }}
        open={editing}
        onClose={() => setEditing(false)}
        saving={updatePerson.isPending}
        error={sheetError}
        onSave={(input) =>
          updatePerson.mutate(
            { id: person.id, ...input },
            { onSuccess: () => setEditing(false), onError: (e) => setSheetError(e.message) },
          )
        }
      />
    </div>
  )
}

export default function PersonPage() {
  const params = useParams<{ id: string }>()
  const people = useHouseholdPeople()
  const person = people.data?.people.find((p) => p.id === params.id && p.kind !== "extra")

  // «Datos físicos» from Tu ficha (`#datos-fisicos`): the cards render once the people are read.
  const ready = !!person
  useEffect(() => {
    if (!ready || !window.location.hash) return
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "start" })
  }, [ready])

  return (
    <SubPage
      eyebrow="Quién come"
      title={person ? person.name : people.isPending ? "…" : "No está en tu casa"}
      intro={person ? (person.kind === "person" && person.ageBand ? `${ageBandPill(person.ageBand)} · sin cuenta en Mimoia` : personAgeLine(person)) : undefined}
    >
      <div className="mt-5" data-testid="person-page">
        {people.isError && <p className="text-[14px] text-ink-muted">No hemos podido cargarlo. Vuelve a intentarlo.</p>}
        {person?.kind === "me" && <Me person={person} />}
        {person?.kind === "member" && <Member person={person} />}
        {person?.kind === "person" &&
          (person.canEdit ? (
            <Person person={person} healthConsent={people.data?.healthConsent ?? false} />
          ) : (
            <Card title="Alergias y dieta">
              <p className="text-[14px] text-ink-muted">Lo cambian los adultos de la casa.</p>
            </Card>
          ))}
      </div>
    </SubPage>
  )
}
