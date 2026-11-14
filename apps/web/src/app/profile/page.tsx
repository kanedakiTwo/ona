'use client'

/**
 * /profile — what Mimo knows of the house, in the order of the questions it
 * asks itself when it plans (PRO-1202, maqueta 2026-11-12-perfil, columna 1):
 * the household's name with a gear to «Ajustes» (/profile/ajustes) and a strip
 * with the last thing Mimo learnt and «Cuéntale más»; then **Vuestra semana**
 * (PRO-1204), **Quién come** (PRO-1203), **Cómo cocináis**, **Lo que os
 * gusta** and **La compra**, each a list of rows with a status line that open
 * the screen that changes it. Each screen saves its own: no «Guardar cambios».
 * Account, alerts, plan and privacy live in Ajustes; «Mis recetas» and
 * «Recetarios» in Recetas; the pantry in Cocinar.
 */
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { ChevronRight, Settings } from 'lucide-react'
import { InviteHouseholdButton } from '@/components/referrals/InviteHouseholdButton'
import { DISPLAY_UI } from '@/components/recipes/RecipeCard'
import { FoundingBadge } from '@/components/profile/FoundingBadge'
import { SUB_LIST } from '@/components/profile/SubPage'
import { WeekTypeHead } from '@/components/weekType/WeekTypeHead'
import { WhoEatsSection } from '@/components/profile/WhoEatsSection'
import { CookingStyleCard } from '@/components/profile/CookingStyleCard'
import { useMimo } from '@/components/mimo/MimoProvider'
import { useUserMemory } from '@/hooks/useUserMemory'
import { useStaples } from '@/hooks/useStaples'
import { useShops } from '@/hooks/useShopOrders'
import { useTasteStatus } from '@/hooks/useTaste'
import { useFicha } from '@/hooks/useFicha'
import { useHouseholdPeople } from '@/hooks/useHouseholdPeople'
import { useAuth } from '@/lib/auth'
import { api, type ApiError } from '@/lib/api'
import { factsCountLabel, portraitOpening, recentlyLearnt, visibleQuestion } from '@/lib/ficha'
import { cuisinesLine, dislikesOfHouse, listLine, skillLine, timeLine } from '@/lib/profileSummary'

export default function ProfilePage() {
  const { user, isLoading: authLoading } = useAuth()

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream pb-12">
      <div className="mx-auto w-full max-w-[var(--page-max)] lg:px-12 lg:pt-8">
        <ProfileHeader />
        <LearntStrip />

        {/* PRO-1204: the semana tipo heads the profile — the menu comes out of it. */}
        <div className="mt-6 lg:mt-8">
          <WeekTypeHead />
        </div>

        <div className="mt-8 grid gap-8 px-5 lg:mt-10 lg:grid-cols-2 lg:items-start lg:gap-x-6 lg:gap-y-10 lg:px-0">
          {/* «Quién come» (PRO-1203): one row per person; allergies, dislikes, health and goal inside each. */}
          <WhoEatsSection />
          <HowYouCook />
          <WhatYouLike />
          <Shopping />
        </div>

<<<<<<< 39d7350fb2075e40dcd7195394a921ec7d232308
        {/* PRO-163: another household, not someone of this one (that's «Invitar» in «Quién come»). */}
        <div className="mt-8 px-5 mb-24 lg:mt-10 lg:max-w-[580px] lg:px-0">
          <InviteHouseholdButton place="perfil" />
=======
        <div className="mt-3 grid gap-3 px-5 lg:mt-4 lg:grid-cols-2 lg:items-start lg:gap-4 lg:px-0">
          {/* Cómo cocináis (PRO-217): saved on tap in the household's ficha. */}
          <CookingStyleCard />

          {/* Voz (D-023: one assistant, the floating button on every page) */}
          <ProfileCard
            icon={Mic}
            title="Voz"
            status={mimo.speakReplies ? 'Mimo lee sus respuestas en voz alta' : 'Mimo lee en voz alta solo cuando le hablas'}
            data-testid="profile-mimo-voice"
          >
            <p className="mt-3 text-[13px] leading-snug text-ink-muted">
              Mimo está en el botón flotante de cualquier pantalla. Toca el micro para hablarle, o activa
              «Manos libres» para conversar sin tocar nada mientras cocinas.
            </p>

            <ToggleRow
              title="Leer las respuestas en voz alta"
              subtitle={mimo.speakReplies ? 'Activo · también cuando escribes' : 'Solo cuando le hablas'}
              on={mimo.speakReplies}
              onToggle={() => mimo.setSpeakReplies(!mimo.speakReplies)}
            />

            {mimo.voices.length > 1 && (
              <label className="flex min-h-[56px] items-center justify-between gap-3 border-t border-border-soft py-2">
                <span className="text-[14px] font-medium text-ink">Voz de Mimo</span>
                <select
                  value={mimo.selectedVoice ?? ''}
                  onChange={(e) => mimo.previewVoice(e.target.value)}
                  className="h-11 max-w-[60%] rounded-full border border-border bg-cream px-3 text-[13px] text-ink focus:border-ink focus:outline-none"
                  aria-label="Voz de Mimo"
                >
                  {mimo.voices.map((v) => (
                    <option key={v.key} value={v.key}>{v.name}</option>
                  ))}
                </select>
              </label>
            )}

          </ProfileCard>

          {/* WhatsApp. Hidden unless the server has the channel configured for
              this account (or a phone is already linked, so it can always be
              disconnected). */}
          {showWhatsApp && whatsapp.data && (
            <ProfileCard
              icon={MessageCircle}
              title="WhatsApp"
              status={whatsapp.data.linked ? 'Conectado' : 'Sin conectar'}
            >
              <p className="mt-3 text-[13px] leading-snug text-ink-muted">
                Todo lo que hace el asistente, desde tu WhatsApp: escríbele,
                mándale audios o compártele recetas.
              </p>
              <div className="mt-3">
                <WhatsAppCard status={whatsapp.data} />
              </div>
            </ProfileCard>
          )}
        </div>

        {/* Ajustes del menú: what the generator reads. */}
        <div className="mt-8 px-5 lg:mt-10 lg:px-0">
          <GroupLabel>Ajustes del menú</GroupLabel>
        </div>
        <div className="mt-3 grid gap-3 px-5 lg:mt-4 lg:items-start lg:gap-4 lg:px-0">
          <div className="grid gap-3 lg:grid-cols-2 lg:items-start lg:gap-4">
            {/* Recordatorios */}
            <ProfileCard
              icon={Bell}
              title="Recordatorios"
              status="Avisos de Mimo y el correo de los viernes"
            >
              <p className="mt-3 text-[13px] leading-snug text-ink-muted">
                Si tienes WhatsApp conectado, Mimo te avisa por ahí. Si no, los
                avisos de preparación (sacar del congelador, poner en remojo) te
                llegan como notificación del móvil.
              </p>

              {/* PRO-237: every alert, by where it arrives, with its switch. */}
              <Link
                href="/profile/avisos"
                data-testid="profile-avisos-link"
                className="mt-2 flex min-h-[56px] w-full items-center justify-between gap-3 border-t border-border-soft py-2"
              >
                <div className="min-w-0 text-left">
                  <div className="text-[14px] font-medium text-ink">Avisos</div>
                  <div className="truncate text-[12px] text-ink-muted">Qué te llega, por dónde, y apagarlos</div>
                </div>
                <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" className="text-ink-light" />
              </Link>

              {/* Web Push — server-side notifications that survive a closed tab. */}
              <PushNotificationsCard />

              {/* Friday menu email (PRO-95): its own consent, saved on tap. */}
              <NewsletterToggle />

              {/* «Enviar a <cadena>» (D-154): lo aceptado por cadena, con «Desactivar». Sin nada aceptado, nada. */}
              <BasketConsentsCard />
            </ProfileCard>

            {/* Mis recetas */}
            <ProfileCard
              icon={ChefHat}
              title="Mis recetas"
              status="Las que has creado tú. Edítalas o elimínalas si ya no las usas."
            >
              <div className="mt-4">
                <MyRecipesSection />
              </div>
            </ProfileCard>
          </div>
        </div>

        {/* Tu cuenta — session, privacy + right to erasure */}
        <div className="mt-8 px-5 mb-24 lg:mt-10 lg:px-0">
          <GroupLabel>Tu cuenta</GroupLabel>
          <ProfileCard
            icon={UserRound}
            title={user.username}
            status={user.email}
            className="mt-3 lg:mt-4 lg:max-w-[580px]"
          >
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border-soft pt-3">
              <button
                type="button"
                onClick={logout}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:bg-cream-deep"
              >
                <LogOut size={16} strokeWidth={1.8} />
                Salir
              </button>
              <a
                href="/privacidad"
                className="inline-flex min-h-[44px] items-center text-[13px] text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                Política de privacidad
              </a>
            </div>
            {user.id && (
              <div className="mt-2">
                <DeleteAccountCard userId={user.id} />
              </div>
            )}
          </ProfileCard>
>>>>>>> 5327c384f45af36e75bd83ab81fe2609fc339da9
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────── */

/**
 * «Tu casa» and the household's name as the h1 (Fraunces 650, like /menu
 * and /recipes), the founding badge, and the gear to Ajustes.
 */
function ProfileHeader() {
  const household = useQuery<{ name: string; founding?: boolean }>({
    queryKey: ['household', 'me'],
    queryFn: () => api.get<{ name: string; founding?: boolean }>('/households/me'),
  })
  return (
    <header className="flex items-start justify-between gap-3 px-5 pt-3 lg:px-0 lg:pt-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">Tu casa</p>
        {household.isPending ? (
          <span aria-hidden="true" className="my-1.5 block h-7 w-48 rounded-full bg-bone lg:h-9" />
        ) : (
          <h1 className={`${DISPLAY_UI} text-[30px] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]`}>
            {household.data?.name || 'Tu casa'}
          </h1>
        )}
        {household.data?.founding && <FoundingBadge className="my-1" />}
      </div>
      <Link
        href="/profile/ajustes"
        aria-label="Ajustes"
        data-testid="profile-settings-link"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <Settings size={20} strokeWidth={1.8} aria-hidden="true" />
      </Link>
    </header>
  )
}

/**
 * The strip under the name: the last thing Mimo learnt (else how its
 * portrait of the house starts, else that it knows little yet), «Tu ficha» with what it knows and a waiting question, and
 * «Cuéntale más» (Mimo opens with a draft). A `child` member (403) or a user
 * without a household (404) doesn't get it.
 */
function LearntStrip() {
  const ficha = useFicha()
  const mimo = useMimo()
  const status = (ficha.error as ApiError | null)?.status
  if (status === 403 || status === 404) return null
  const view = ficha.data
  const last = view ? recentlyLearnt(view.recent, 1)[0] : undefined
  const question = view ? visibleQuestion(view) : null

  return (
    <section data-testid="profile-ficha" aria-label="Lo que sabe Mimo" className="mx-5 mt-4 rounded-[20px] bg-cream-deep/70 px-4 py-3.5 lg:mx-0 lg:mt-5 lg:px-5">
      {view ? (
        <p className="text-[14px] leading-snug text-ink-mid">
          {last ? (
            <>
              Lo último que ha aprendido Mimo: <span className="font-medium text-ink">{last.sentence.replace(/\.$/, '')}</span>.
            </>
          ) : view.portrait ? (
            <span className="italic [font-family:var(--font-italic)]">«{portraitOpening(view.portrait.text)}»</span>
          ) : (
            'Todavía os conozco poco.'
          )}
        </p>
      ) : ficha.isPending ? (
        <span aria-hidden="true" className="block h-4 w-11/12 animate-pulse rounded-full bg-bone" />
      ) : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link href="/profile/ficha" className="inline-flex min-h-[44px] items-center gap-1 text-[13px] font-semibold text-ink hover:underline">
          Tu ficha
          {view && view.facts.length > 0 && <span className="font-normal text-ink-muted">· {factsCountLabel(view.facts.length)}</span>}
          {question && <span className="font-medium text-terracotta-deep">· 1 pregunta para ti</span>}
          <ChevronRight size={15} strokeWidth={1.8} aria-hidden="true" className="text-ink-light" />
        </Link>
        <button
          type="button"
          onClick={() => mimo.open({ draft: 'Te cuento algo de casa: ' })}
          className="inline-flex min-h-[44px] items-center text-[13px] font-semibold text-terracotta-deep hover:underline"
        >
          Cuéntale más
        </button>
      </div>
    </section>
  )
}

/** A profile section: its kicker and a paper list of rows. */
function Section({ id, title, children, after }: { id: string; title: string; children: ReactNode; after?: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} data-testid={id}>
      <h2 id={`${id}-title`} className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">
        {title}
      </h2>
      <ul className={`${SUB_LIST} mt-2`}>{children}</ul>
      {after}
    </section>
  )
}

/** One row: what it is, its status, and the screen that changes it. */
function Row({ href, title, status }: { href: string; title: string; status: ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex min-h-[60px] items-center gap-3 px-4 py-3 transition-colors hover:bg-cream-deep/40">
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium text-ink">{title}</span>
          <span className="block truncate text-[12.5px] text-ink-muted">{status}</span>
        </span>
        <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-light" />
      </Link>
    </li>
  )
}

const LOADING = '…'
const UNSAID = 'Sin decir todavía'

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/** «Cómo cocináis»: tiempo, aparatos and nivel (the memory), then the style (PRO-217). */
function HowYouCook() {
  const memory = useUserMemory()
  const m = memory.data
  const show = (line: string | null) => (m == null ? LOADING : line ?? UNSAID)
  return (
    <Section
      id="profile-cooking"
      title="Cómo cocináis"
      after={
        <div className="mt-3">
          <CookingStyleCard />
        </div>
      }
    >
      <Row href="/profile/memoria#rutina" title="Tiempo" status={show(timeLine(m?.time_available?.value))} />
      <Row href="/profile/memoria#cocina" title="Aparatos" status={show(listLine(m?.equipment?.value))} />
      <Row href="/profile/memoria#cocina" title="Nivel" status={show(skillLine(m?.cooking_skill?.value))} />
    </Section>
  )
}

/** «Lo que os gusta»: cocinas, «No os gusta», «Lo que os importa» (Creencias) and «Afina tu menú». */
function WhatYouLike() {
  const memory = useUserMemory()
  const people = useHouseholdPeople()
  const taste = useTasteStatus()
  const m = memory.data
  const principles = m?.nutrition_principles?.value
  const principlesCount = Array.isArray(principles) ? principles.length : m ? 0 : null
  const dislikes =
    people.data || m ? dislikesOfHouse([...(people.data?.people.map((p) => p.dislikes) ?? []), m?.dislikes?.value as string[] | undefined]) : null

  return (
    <Section id="profile-likes" title="Lo que os gusta">
      <Row href="/profile/memoria#rutina" title="Cocinas" status={m == null ? LOADING : cuisinesLine(m.cuisine_bias?.value) ?? UNSAID} />
      <Row
        href="/profile/quien/me"
        title="No os gusta"
        status={dislikes == null ? LOADING : listLine(dislikes) ?? 'Nada apuntado'}
      />
      <Row
        href="/profile/creencias"
        title="Lo que os importa"
        status={
          principlesCount == null
            ? LOADING
            : principlesCount === 0
              ? 'Ninguna creencia todavía'
              : listLine(principles, 2) ?? plural(principlesCount, 'principio', 'principios')
        }
      />
      <Row
        href="/afinar"
        title="Afina tu menú"
        status={taste.data == null ? LOADING : `${taste.data.rated} de ${taste.data.total} recetas valoradas`}
      />
    </Section>
  )
}

/** «La compra»: los básicos fijos y tus tiendas. */
function Shopping() {
  const staples = useStaples()
  const shops = useShops()
  return (
    <Section id="profile-shopping" title="La compra">
      <Row
        href="/profile/staples"
        title="Básicos fijos"
        status={
          staples.data == null
            ? LOADING
            : staples.data.length === 0
              ? 'Ningún básico todavía'
              : `${plural(staples.data.length, 'producto', 'productos')} cada semana`
        }
      />
      <Row
        href="/compra/tiendas"
        title="Tus tiendas"
        status={shops.data == null ? LOADING : listLine(shops.data.map((s) => s.name), 3) ?? 'Ninguna todavía'}
      />
    </Section>
  )
}
