"use client"

/**
 * «Lo que recuerdo de ti» → «Del perfil» (PRO-201): who eats at home and the
 * reader's allergies and diet, read from the profile (`/households/me/people`,
 * the same view as «Quién come»), with a link to change them there. Until
 * 2026-11-24 the page read only Mimo's memory, so a vegetarian saw
 * «Restricciones · Añadir» and a house of two «Adultos en casa · Añadir».
 */
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { useHouseholdPeople, type HouseholdPeopleView } from "@/hooks/useHouseholdPeople"
import { countsLine } from "@/components/profile/WhoEatsSection"
import { SUB_EYEBROW, SUB_LIST } from "@/components/profile/SubPage"

/** «Laura (tú), Jorge y la pequeña · 2 adultos y 1 niño». */
export function peopleLine(view: Pick<HouseholdPeopleView, "people" | "counts">): string {
  const names = view.people
    .filter((p) => p.kind !== "extra")
    .map((p) => (p.kind === "me" ? `${p.name} (tú)` : p.name))
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
  const counts = countsLine(view.counts)
  return list ? `${list} · ${counts}` : counts
}

/** The reader's allergies and diet: the list, «Ninguna» when answered, or not said yet. */
export function dietLine(view: Pick<HouseholdPeopleView, "people">): string {
  const me = view.people.find((p) => p.kind === "me")
  const list = me?.restrictions ?? []
  if (list.length > 0) return list.join(", ")
  return me?.answered ? "Ninguna" : "Aún no nos lo has dicho"
}

function ProfileRow({ href, label, value, testId }: { href: string; label: string; value: string; testId: string }) {
  return (
    <li>
      <Link href={href} data-testid={testId} className="flex min-h-[56px] items-center justify-between gap-3 py-2 pl-4 pr-3">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink-muted">{label}</span>
            <span className="rounded-full bg-cream-deep px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Perfil
            </span>
          </span>
          <span className="mt-0.5 block break-words text-[15px] text-ink">{value}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
      </Link>
    </li>
  )
}

export function MemoryProfileSection() {
  const people = useHouseholdPeople()
  const view = people.data
  const loading = people.isLoading ? "…" : null
  return (
    <section id="perfil" className="mb-8 scroll-mt-4" data-testid="memory-profile">
      <h2 className={SUB_EYEBROW}>Del perfil</h2>
      <ul className={`${SUB_LIST} mt-3`}>
        <ProfileRow
          href="/profile/quien/me"
          label="Tus alergias y tu dieta"
          value={loading ?? (view ? dietLine(view) : "Míralas en tu perfil")}
          testId="memory-profile-diet"
        />
        <ProfileRow
          href="/profile#who-eats"
          label="Quién come en casa"
          value={loading ?? (view ? peopleLine(view) : "Míralo en tu perfil")}
          testId="memory-profile-people"
        />
      </ul>
      <p className="mt-2 text-[13px] text-ink-muted">El menú y Mimo las tienen en cuenta. Se cambian en tu perfil.</p>
    </section>
  )
}
