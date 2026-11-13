'use client'

/**
 * /profile — "D · Luz y foto" (PRO-39): compact header with the household's
 * name, «Tu ficha» first and full width (PRO-318), then paper cards per
 * section (Casa, Afina tu menú, Creencias, Despensa, Fijos, Recetarios,
 * Suscripción, Voz, WhatsApp) with an icon and a status line, «Quién come»
 * (PRO-1203: one row per person, with their allergies, dislikes, health and
 * goal inside), the menu settings and the account card. Each screen saves
 * its own: there is no «Guardar cambios» any more.
 * Secondary actions sit behind "···" sheets (`MenuSheet`). 2–3 columns at lg+.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { InviteHouseholdButton } from '@/components/referrals/InviteHouseholdButton'
import {
  Archive,
  Bell,
  BellOff,
  BookOpen,
  ChefHat,
  ChevronRight,
  CreditCard,
  Compass,
  Heart,
  Home,
  LogOut,
  MessageCircle,
  Mic,
  Plus,
  Repeat,
  Send,
  Shield,
  UserRound,
  Wrench,
} from 'lucide-react'
import Link from 'next/link'
import { MenuSheet, SheetAction } from '@/components/menu/MenuSheet'
import { DISPLAY_UI } from '@/components/recipes/RecipeCard'
import { useUserMemory } from '@/hooks/useUserMemory'
import { usePantry } from '@/hooks/usePantry'
import { useStaples } from '@/hooks/useStaples'
import { useCookbooks } from '@/hooks/useCookbooks'
import { useBilling } from '@/hooks/useBilling'
import { useTasteStatus } from '@/hooks/useTaste'
import { FoundingBadge } from '@/components/profile/FoundingBadge'
import { FichaHubCard } from '@/components/ficha/FichaHubCard'
import { GroupLabel, MoreButton, ProfileCard, ProfileHubLink, Switch } from './sections/ProfileCards'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useWebPush } from '@/hooks/useWebPush'
import { useMimo } from '@/components/mimo/MimoProvider'
import { MyRecipesSection } from './sections/MyRecipesSection'
import { WeekTypeHead } from '@/components/weekType/WeekTypeHead'
import { WhatsAppCard } from '@/components/profile/WhatsAppCard'
import { CookingStyleCard } from '@/components/profile/CookingStyleCard'
import { WhoEatsSection } from '@/components/profile/WhoEatsSection'
import { DeleteAccountCard } from '@/components/profile/DeleteAccountCard'
import { NewsletterToggle } from '@/components/profile/NewsletterToggle'
import { BasketConsentsCard } from '@/components/profile/BasketConsentsCard'
import { useWhatsAppStatus } from '@/hooks/useWhatsApp'
import { subscriptionSummary } from '@ona/shared'

export default function ProfilePage() {
  const { user, logout, updateUser, isLoading: authLoading } = useAuth()
  const whatsapp = useWhatsAppStatus()
  const mimo = useMimo()

  const [moreOpen, setMoreOpen] = useState(false)

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  const showWhatsApp = Boolean(whatsapp.data?.available || whatsapp.data?.linked)

  return (
    <div className="min-h-screen bg-cream pb-12">
      <div className="mx-auto w-full max-w-[var(--page-max)] lg:px-12 lg:pt-8">
        <ProfileHeader
          username={user.username}
          email={user.email}
          onMore={() => setMoreOpen(true)}
        />

        {/* PRO-1204: the semana tipo heads the profile — the menu comes out of it. */}
        <div className="mt-5 lg:mt-6">
          <WeekTypeHead />
        </div>

        {/* Casa y Mimo: one paper card per sub-page, with a status line. */}
        <div className="mt-6 px-5 lg:mt-8 lg:px-0">
          <GroupLabel>Tu casa y Mimo</GroupLabel>
          <ProfileHub />
          {/* PRO-163: another household, not someone of this one (that's «Invitar a alguien» in Casa). */}
          <InviteHouseholdButton place="perfil" className="mt-3 lg:mt-4" />
        </div>

        {/* «Quién come» (PRO-1203): one row per person; allergies, dislikes, health and goal inside each. */}
        <div className="mt-8 px-5 lg:mt-10 lg:max-w-[720px] lg:px-0">
          <WhoEatsSection />
        </div>

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
<<<<<<< 31f3ab6b31de82ec692fd2467c7aa39d7760dea9
        <div className="mt-3 grid gap-3 px-5 lg:mt-4 lg:grid-cols-2 lg:items-start lg:gap-4 lg:px-0">
          <div className="grid gap-3 lg:gap-4">
            {/* Datos físicos (RGPD art. 9: only with the health-data consent) */}
            <ProfileCard
              id="datos-fisicos"
              icon={Ruler}
              title="Datos físicos"
              status={
                !healthActive
                  ? 'Sin tu consentimiento no se guardan'
                  : tdee
                    ? `Gasto diario estimado: ${tdee} kcal`
                    : 'Completa sexo, edad, peso y altura'
              }
            >
              <div className="mt-4" data-testid="health-consent">
                <HealthConsentCheckbox
                  checked={healthActive}
                  disabled={consentBusy || healthConsent === null}
                  onChange={handleHealthConsent}
                />
                {!healthActive && healthConsent !== null && (
                  <p className="mt-2 text-[12px] italic text-ink-muted">
                    Sin tu consentimiento no guardamos datos físicos, alergias ni restricciones.
                  </p>
                )}
              </div>
              <fieldset disabled={!healthActive} className={`mt-5 space-y-5 ${healthActive ? '' : 'opacity-40'}`}>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Sexo" className="col-span-2">
                    <div className="flex gap-1.5 pt-1">
                      <SexPill
                        active={physical.sex === 'male'}
                        onClick={() => setPhysical((p) => ({ ...p, sex: 'male' }))}
                      >
                        Masculino
                      </SexPill>
                      <SexPill
                        active={physical.sex === 'female'}
                        onClick={() => setPhysical((p) => ({ ...p, sex: 'female' }))}
                      >
                        Femenino
                      </SexPill>
                    </div>
                  </Field>
                  <Field label="Edad">
                    <input
                      type="number" min={1} max={120}
                      value={physical.age}
                      onChange={(e) => setPhysical((p) => ({ ...p, age: e.target.value ? Number(e.target.value) : '' }))}
                      placeholder="—"
                      className="input-line"
                    />
                  </Field>
                  <Field label="Peso · kg">
                    <input
                      type="number" min={20} max={300} step={0.1}
                      value={physical.weight}
                      onChange={(e) => setPhysical((p) => ({ ...p, weight: e.target.value ? Number(e.target.value) : '' }))}
                      placeholder="—"
                      className="input-line"
                    />
                  </Field>
                  <Field label="Altura · cm">
                    <input
                      type="number" min={100} max={250}
                      value={physical.height}
                      onChange={(e) => setPhysical((p) => ({ ...p, height: e.target.value ? Number(e.target.value) : '' }))}
                      placeholder="—"
                      className="input-line"
                    />
                  </Field>
                </div>

                <div>
                  <Label>Nivel de actividad</Label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
                      <Pill
                        key={value}
                        active={physical.activity_level === value}
                        onClick={() => setPhysical((p) => ({ ...p, activity_level: value as PhysicalData['activity_level'] }))}
                      >
                        {label}
                      </Pill>
                    ))}
                  </div>
                </div>
              </fieldset>

              {bmr && tdee && (
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border-soft pt-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Metabolismo basal</div>
                    <div className="mt-1 font-serif-text text-[24px] font-[650] text-ink">
                      {bmr}<span className="ml-1 text-[13px] font-normal text-ink-muted">kcal</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Gasto diario</div>
                    <div className="mt-1 font-serif-text text-[24px] font-[650] text-terracotta-deep">
                      {tdee}<span className="ml-1 text-[13px] font-normal text-ink-muted">kcal</span>
                    </div>
                  </div>
                </div>
              )}
            </ProfileCard>

            {/* Preferencias */}
            <ProfileCard
              icon={SlidersHorizontal}
              title="Preferencias"
              status={`${household.adults} ${household.adults === 1 ? 'adulto' : 'adultos'} · ${household.kidsCount} ${household.kidsCount === 1 ? 'niño' : 'niños'} · ${PRIORITY_LABELS[preferences.priority] ?? ''}`}
            >
              <div className="mt-4 space-y-6">
                <div>
                  <Label>Hogar (para escalar la compra)</Label>
                  <p className="mt-1 text-[12px] italic leading-snug text-ink-muted">
                    Adultos cuenta a partir de 11 años. Niños son 2 a 10. Menores de 2 no cuentan. Cada niño cuenta como media ración.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Stepper
                      label="Adultos"
                      value={household.adults}
                      onMinus={() => setHousehold((h) => ({ ...h, adults: Math.max(1, h.adults - 1) }))}
                      onPlus={() => setHousehold((h) => ({ ...h, adults: Math.min(20, h.adults + 1) }))}
                      minusLabel="Quitar adulto"
                      plusLabel="Añadir adulto"
                    />
                    <Stepper
                      label="Niños 2–10"
                      value={household.kidsCount}
                      onMinus={() => setHousehold((h) => ({ ...h, kidsCount: Math.max(0, h.kidsCount - 1) }))}
                      onPlus={() => setHousehold((h) => ({ ...h, kidsCount: Math.min(20, h.kidsCount + 1) }))}
                      minusLabel="Quitar niño"
                      plusLabel="Añadir niño"
                    />
                  </div>
                </div>

                <div>
                  <Label>Prioridad nutricional</Label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                      <Pill
                        key={value}
                        active={preferences.priority === value}
                        onClick={() => setPreferences((p) => ({ ...p, priority: value as Preferences['priority'] }))}
                      >
                        {label}
                      </Pill>
                    ))}
                  </div>
                </div>

                <fieldset disabled={!healthActive} className={healthActive ? '' : 'opacity-40'}>
                  <Label>Alergias, intolerancias y dieta</Label>
                  {preferences.restrictions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {preferences.restrictions.map((r) => (
                        <motion.span
                          key={r}
                          layout
                          initial={{ scale: 0.85, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="inline-flex h-10 items-center gap-0.5 rounded-full bg-ink pl-3.5 pr-0.5 text-[13px] text-cream"
                        >
                          {r}
                          <button
                            type="button"
                            onClick={() => removeRestriction(r)}
                            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-cream/15"
                            aria-label={`Quitar ${r}`}
                          >
                            <X size={13} />
                          </button>
                        </motion.span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {COMMON_RESTRICTIONS.filter((r) => !preferences.restrictions.includes(r)).map((r) => (
                      <button
                        type="button"
                        key={r}
                        onClick={() => addRestriction(r)}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-dashed border-border bg-transparent px-3.5 text-[13px] text-ink-muted hover:border-ink hover:text-ink"
                      >
                        <Plus size={12} /> {r}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      value={restrictionInput}
                      onChange={(e) => setRestrictionInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); addRestriction(restrictionInput) }
                      }}
                      placeholder="Otra, p. ej. pimiento"
                      className="input-line flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => addRestriction(restrictionInput)}
                      disabled={!restrictionInput.trim()}
                      className="h-11 rounded-full bg-ink px-5 text-[13px] font-medium text-cream disabled:opacity-30"
                    >
                      Añadir
                    </button>
                  </div>
                  <ReligionConsentNote
                    restrictions={preferences.restrictions}
                    needsConsent={needsReligion}
                    checked={false}
                    onChange={handleReligionConsent}
                    disabled={consentBusy}
                  />
                  {religionDropped && needsReligion && (
                    <p role="alert" className="mt-2 text-[13px] text-terracotta-deep">
                      No hemos guardado «halal»: marca la casilla del texto nuevo para guardarlo.
                    </p>
                  )}
                </fieldset>
              </div>
            </ProfileCard>
          </div>

          <div className="grid gap-3 lg:gap-4">
=======
        <div className="mt-3 grid gap-3 px-5 lg:mt-4 lg:items-start lg:gap-4 lg:px-0">
          <div className="grid gap-3 lg:grid-cols-2 lg:items-start lg:gap-4">
            {/* «Tu semana tipo» (D-182): its own page. */}
            <ProfileHubLink
              href="/profile/semana-tipo"
              icon={CalendarDays}
              title="Tu semana tipo"
              status="Lo que soléis comer cada día: el menú sale de ahí"
            />

>>>>>>> 89f69be5d338cf5ffa9233b1973064253d162921
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
        </div>
      </div>

      <MenuSheet open={moreOpen} onClose={() => setMoreOpen(false)} eyebrow="Perfil" title="Más opciones">
        <div className="flex flex-col gap-1">
          <SheetAction
            icon={Mic}
            label="Onboarding por voz"
            hint="Cuéntale a Mimo cómo coméis en casa y lo guarda en su memoria"
            href="/onboarding/voz"
          />
          {user.role === 'admin' && (
            <SheetAction icon={Shield} label="Panel de admin" href="/admin" />
          )}
        </div>
      </MenuSheet>
    </div>
  )
}

/* ─────────────────────────────────────────── */

/**
 * Compact header (PRO-39): eyebrow with the user, the household's name as
 * the h1 (Fraunces 650, like /menu and /recipes) and a "···" for the
 * secondary actions.
 */
function ProfileHeader({ username, email, onMore }: { username: string; email: string; onMore: () => void }) {
  const household = useQuery<{ name: string; founding?: boolean }>({
    queryKey: ['household', 'me'],
    queryFn: () => api.get<{ name: string; founding?: boolean }>('/households/me'),
  })
  return (
    <header className="flex items-start justify-between gap-3 px-5 pt-3 lg:px-0 lg:pt-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">
          Perfil · <span className="normal-case tracking-normal">{username}</span>
        </p>
        {household.isPending ? (
          <span aria-hidden="true" className="my-1.5 block h-7 w-48 rounded-full bg-bone lg:h-9" />
        ) : (
          <h1 className={`${DISPLAY_UI} text-[30px] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]`}>
            {household.data?.name || 'Tu casa'}
          </h1>
        )}
        {household.data?.founding && <FoundingBadge className="my-1" />}
        <p className="truncate text-[13px] text-ink-muted">{email}</p>
      </div>
      <MoreButton onClick={onMore} label="Más opciones del perfil" />
    </header>
  )
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * «Tu ficha» first and full width (PRO-318: it took the place of «Memoria»,
 * whose page lives on behind «Editar mis datos uno a uno»), then the
 * sub-page cards, each with a one-line status from its own data.
 */
function ProfileHub() {
  const household = useQuery<{ members: unknown[]; pendingInvites?: unknown[] }>({
    queryKey: ['household', 'me'],
    queryFn: () => api.get('/households/me'),
  })
  const memory = useUserMemory()
  const pantry = usePantry()
  const staples = useStaples()
  const cookbooks = useCookbooks()
  const billing = useBilling()
  const taste = useTasteStatus()

  const principles = memory.data?.nutrition_principles?.value
  const principlesCount = Array.isArray(principles) ? principles.length : memory.data ? 0 : null

  const loading = '…'
  const members = household.data?.members.length
  return (
    <>
      <div className="mt-3 lg:mt-4">
        <FichaHubCard />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:mt-4 lg:grid-cols-3 lg:gap-4">
        <ProfileHubLink
          href="/profile/casa"
          icon={Home}
          title="Casa"
          status={members == null ? (household.isError ? 'Tu hogar' : loading) : members === 1 ? 'Solo tú' : plural(members, 'persona', 'personas')}
        />
        <ProfileHubLink
          href="/afinar"
          icon={Heart}
          title="Afina tu menú"
          status={taste.data == null ? loading : `${taste.data.rated} de ${taste.data.total} valoradas`}
        />
        <ProfileHubLink
          href="/profile/creencias"
          icon={Compass}
          title="Creencias"
          status={principlesCount == null ? loading : principlesCount === 0 ? 'Ninguna todavía' : plural(principlesCount, 'principio', 'principios')}
        />
        <ProfileHubLink
          href="/cocinar#despensa"
          icon={Archive}
          title="Despensa"
          status={pantry.data == null ? loading : pantry.data.length === 0 ? 'Vacía' : plural(pantry.data.length, 'producto', 'productos')}
        />
        <ProfileHubLink
          href="/profile/staples"
          icon={Repeat}
          title="Fijos"
          status={staples.data == null ? loading : staples.data.length === 0 ? 'Ningún básico todavía' : plural(staples.data.length, 'básico', 'básicos')}
        />
        <ProfileHubLink
          href="/profile/cookbooks"
          icon={BookOpen}
          title="Recetarios"
          status={cookbooks.data == null ? loading : cookbooks.data.length === 0 ? 'Ninguno todavía' : plural(cookbooks.data.length, 'recetario', 'recetarios')}
        />
        <ProfileHubLink
          href="/profile/suscripcion"
          icon={CreditCard}
          title="Suscripción"
          status={
            billing.data == null
              ? billing.isError ? 'Tu plan' : loading
              : billing.data.subscription
                ? subscriptionSummary(billing.data.subscription).hub
                : billing.data.beta ? 'Beta: Plus gratis' : billing.data.access?.state === 'gratis' ? 'Plan Gratis' : 'Sin plan'
          }
        />
      </div>
      <p className="mt-3 text-[13.5px] leading-[1.5] text-ink-muted lg:mt-4">
        «Lo que recuerdo de ti» pasa a ser parte de tu ficha: lo mismo, más lo que aprendo cada noche, con el porqué de cada cosa.
      </p>
    </>
  )
}

/**
 * Renders the Web Push opt-in block inside the Recordatorios card.
 *
 * The button stays hidden when:
 *   - the browser doesn't support Push (esp. iOS Safari pre-install),
 *   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is missing at build time.
 *
 * On iOS, the user must "Add to Home Screen" first; we surface a tip
 * line so they don't think the button is broken. "Enviar prueba" and
 * "Reparar service worker" live behind its "···" (PRO-39).
 */
async function resetServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  const regs = await navigator.serviceWorker.getRegistrations()
  await Promise.all(regs.map((r) => r.unregister()))
  if (typeof caches !== 'undefined') {
    const names = await caches.keys()
    await Promise.all(names.map((n) => caches.delete(n)))
  }
  window.location.reload()
}

function PushNotificationsCard() {
  const { state, error, subscribe, unsubscribe, sendTest } = useWebPush()
  const [sheetOpen, setSheetOpen] = useState(false)

  if (state === 'unsupported') {
    return (
      <p className="mt-3 border-t border-border-soft pt-3 text-[12px] leading-snug text-ink-muted">
        Las notificaciones push no están disponibles en este navegador. En
        iPhone tienes que añadir la app a inicio primero (Compartir → Añadir
        a pantalla de inicio).
      </p>
    )
  }

  const isSubscribed = state === 'subscribed'
  const isWorking = state === 'subscribing'

  return (
    <div className="mt-3 border-t border-border-soft pt-3">
      <div className="flex items-start gap-3">
        {isSubscribed ? (
          <Bell size={18} className="mt-0.5 shrink-0 text-ink" />
        ) : (
          <BellOff size={18} className="mt-0.5 shrink-0 text-ink-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-ink">
            Notificaciones del móvil
          </div>
          <div className="mt-1 text-[12px] leading-snug text-ink-muted">
            Llegan aunque la app esté cerrada. Sin WhatsApp, por aquí te llegan
            los avisos de preparación; con WhatsApp, solo si un aviso no puede
            salir por WhatsApp.{' '}
            {state === 'denied' && (
              <span className="text-terracotta-deep">
                Has denegado el permiso; cámbialo en los ajustes del
                navegador.
              </span>
            )}
            {error && <span className="text-terracotta-deep"> {error}</span>}
          </div>

          <div className="mt-3 flex items-center gap-2">
            {isSubscribed ? (
              <button
                type="button"
                onClick={unsubscribe}
                className="h-11 rounded-full border border-border bg-paper px-4 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
              >
                Desactivar
              </button>
            ) : (
              <button
                type="button"
                onClick={subscribe}
                disabled={isWorking}
                className="h-11 rounded-full bg-ink px-4 text-[13px] font-medium text-cream transition-colors hover:bg-ink-mid disabled:opacity-50"
              >
                {isWorking ? 'Activando…' : 'Activar notificaciones'}
              </button>
            )}
            <MoreButton onClick={() => setSheetOpen(true)} label="Más opciones de las notificaciones push" />
          </div>
        </div>
      </div>

      <MenuSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        eyebrow="Notificaciones push"
        title="Más opciones"
      >
        <div className="flex flex-col gap-1">
          {isSubscribed ? (
            <SheetAction
              icon={Send}
              label="Enviar prueba"
              hint="Te llega un aviso de prueba a este dispositivo"
              onClick={() => {
                setSheetOpen(false)
                sendTest()
              }}
            />
          ) : (
            /* Recovery escape hatch while subscribe hasn't succeeded: some
               users have a stale broken SW from a previous deploy; one tap
               nukes everything and reloads cleanly. */
            <SheetAction
              icon={Wrench}
              label="Reparar service worker"
              hint="Borra la caché de la app y recarga la página"
              onClick={() => {
                resetServiceWorker().catch(() => {})
              }}
            />
          )}
        </div>
      </MenuSheet>
    </div>
  )
}

function ToggleRow({ title, subtitle, on, onToggle }: { title: string; subtitle: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-2 flex min-h-[56px] w-full items-center justify-between gap-3 border-t border-border-soft py-2"
      aria-pressed={on}
    >
      <div className="min-w-0 text-left">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="truncate text-[12px] text-ink-muted">{subtitle}</div>
      </div>
      <Switch on={on} />
    </button>
  )
}
