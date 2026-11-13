'use client'

/**
 * /profile/ajustes — «Ajustes» (PRO-1202, maqueta 2026-11-12-perfil,
 * columna 2), behind the gear of /profile: what doesn't change the menu, in
 * four blocks. **Mimo** (WhatsApp, voz, «Cuéntaselo de una vez»), **Avisos**
 * (qué te llega, notificaciones del móvil, el correo de los viernes),
 * **Plan** (Suscripción) and **Cuenta y privacidad** (correo, permisos de
 * salud y de compra, tus datos y borrar la cuenta, cerrar sesión, el panel
 * de admin). Each control saves on tap, as it did on /profile.
 */
import { useState } from 'react'
import Link from 'next/link'
import {
  Bell,
  BellOff,
  ChevronRight,
  CreditCard,
  Download,
  LogOut,
  MessageCircle,
  Mic,
  Send,
  Shield,
  Wrench,
} from 'lucide-react'
import { subscriptionSummary } from '@ona/shared'
import { MenuSheet, SheetAction } from '@/components/menu/MenuSheet'
import { GroupLabel, MoreButton, ProfileCard, ProfileHubLink, Switch } from '../sections/ProfileCards'
import { SUB_LIST, SubPage } from '@/components/profile/SubPage'
import { WhatsAppCard } from '@/components/profile/WhatsAppCard'
import { DeleteAccountCard } from '@/components/profile/DeleteAccountCard'
import { NewsletterToggle } from '@/components/profile/NewsletterToggle'
import { BasketConsentsCard } from '@/components/profile/BasketConsentsCard'
import { useMimo } from '@/components/mimo/MimoProvider'
import { useAuth } from '@/lib/auth'
import { useWebPush } from '@/hooks/useWebPush'
import { useBilling } from '@/hooks/useBilling'
import { useWhatsAppStatus } from '@/hooks/useWhatsApp'
import { useHouseholdPeople } from '@/hooks/useHouseholdPeople'

export default function SettingsPage() {
  const { user, logout, isLoading: authLoading } = useAuth()

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  return (
    <SubPage eyebrow="Tu cuenta" title="Ajustes">
      <div className="grid gap-8 pb-16 lg:grid-cols-2 lg:items-start lg:gap-x-6 lg:gap-y-10">
        <MimoBlock />
        <AlertsBlock />
        <PlanBlock />
        <section aria-labelledby="settings-cuenta-title" data-testid="settings-cuenta" className="grid gap-3">
          <span id="settings-cuenta-title">
            <GroupLabel>Cuenta y privacidad</GroupLabel>
          </span>
          <ul className={SUB_LIST}>
            <li className="px-4 py-3">
              <span className="block text-[14px] font-medium text-ink">Correo</span>
              <span className="block truncate text-[13px] text-ink-muted">{user.email}</span>
            </li>
            <HealthConsentRow />
            <li>
              <Link
                href="/profile/ficha"
                className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors hover:bg-cream-deep/40"
              >
                <Download size={17} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-mid" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-ink">Tus datos</span>
                  <span className="block text-[12.5px] text-ink-muted">Lo que sabe Mimo de vosotros, y «Descargar mi ficha»</span>
                </span>
                <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-light" />
              </Link>
            </li>
            <li className="px-4 py-2">
              <a
                href="/privacidad"
                className="inline-flex min-h-[44px] items-center text-[13px] text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                Política de privacidad
              </a>
            </li>
          </ul>

          {/* «Enviar a <cadena>» (D-154): lo aceptado por cadena, con «Desactivar». Sin nada aceptado, nada. */}
          <BasketConsentsCard />

          <div className="rounded-[20px] border border-border-soft bg-paper p-4">
            <DeleteAccountCard userId={user.id} />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={logout}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:bg-cream-deep"
            >
              <LogOut size={16} strokeWidth={1.8} aria-hidden="true" />
              Cerrar sesión
            </button>
            {user.role === 'admin' && (
              <Link
                href="/admin"
                className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-[14px] font-medium text-ink-mid hover:text-ink"
              >
                <Shield size={16} strokeWidth={1.8} aria-hidden="true" />
                Panel de admin
              </Link>
            )}
          </div>
        </section>
      </div>
    </SubPage>
  )
}

/** Mimo: WhatsApp (when the server has the channel, or a phone is linked), voz and the voice onboarding. */
function MimoBlock() {
  const whatsapp = useWhatsAppStatus()
  const mimo = useMimo()
  const showWhatsApp = Boolean(whatsapp.data?.available || whatsapp.data?.linked)

  return (
    <section aria-labelledby="settings-mimo-title" data-testid="settings-mimo" className="grid gap-3">
      <span id="settings-mimo-title">
        <GroupLabel>Mimo</GroupLabel>
      </span>

      {showWhatsApp && whatsapp.data && (
        <ProfileCard icon={MessageCircle} title="WhatsApp" status={whatsapp.data.linked ? 'Conectado' : 'Sin conectar'}>
          <p className="mt-3 text-[13px] leading-snug text-ink-muted">
            Todo lo que hace el asistente, desde tu WhatsApp: escríbele, mándale audios o compártele recetas.
          </p>
          <div className="mt-3">
            <WhatsAppCard status={whatsapp.data} />
          </div>
        </ProfileCard>
      )}

      {/* Voz (D-023: one assistant, the floating button on every page) */}
      <ProfileCard
        icon={Mic}
        title="Voz"
        status={mimo.speakReplies ? 'Mimo lee sus respuestas en voz alta' : 'Mimo lee en voz alta solo cuando le hablas'}
        data-testid="profile-mimo-voice"
      >
        <p className="mt-3 text-[13px] leading-snug text-ink-muted">
          Mimo está en el botón flotante de cualquier pantalla. Toca el micro para hablarle, o activa «Manos libres» para
          conversar sin tocar nada mientras cocinas.
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
                <option key={v.key} value={v.key}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </ProfileCard>

      <ProfileHubLink
        href="/onboarding/voz"
        icon={Mic}
        title="Cuéntaselo de una vez"
        status="Una charla por voz para rellenar tu casa: Mimo lo guarda en su memoria"
      />
    </section>
  )
}

/** Avisos: every alert by where it arrives (/profile/avisos), push and the Friday email. */
function AlertsBlock() {
  return (
    <section aria-labelledby="settings-avisos-title" data-testid="settings-avisos" className="grid gap-3">
      <span id="settings-avisos-title">
        <GroupLabel>Avisos</GroupLabel>
      </span>
      <ProfileCard icon={Bell} title="Qué te llega" status="Avisos de Mimo y el correo de los viernes">
        <p className="mt-3 text-[13px] leading-snug text-ink-muted">
          Si tienes WhatsApp conectado, Mimo te avisa por ahí. Si no, los avisos de preparación (sacar del congelador,
          poner en remojo) te llegan como notificación del móvil.
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
      </ProfileCard>
    </section>
  )
}

function PlanBlock() {
  const billing = useBilling()
  const status =
    billing.data == null
      ? billing.isError
        ? 'Tu plan'
        : '…'
      : billing.data.subscription
        ? subscriptionSummary(billing.data.subscription).hub
        : billing.data.beta
          ? 'Beta: Plus gratis'
          : billing.data.access?.state === 'gratis'
            ? 'Plan Gratis'
            : 'Sin plan'
  return (
    <section aria-labelledby="settings-plan-title" data-testid="settings-plan" className="grid gap-3">
      <span id="settings-plan-title">
        <GroupLabel>Plan</GroupLabel>
      </span>
      <ProfileHubLink href="/profile/suscripcion" icon={CreditCard} title="Suscripción" status={status} />
    </section>
  )
}

/** «Datos de salud»: given once (art. 9.2.a RGPD) when someone's allergies are first written down in «Quién come». */
function HealthConsentRow() {
  const people = useHouseholdPeople()
  const given = people.data?.healthConsent
  return (
    <li className="px-4 py-3" data-testid="settings-health-consent">
      <span className="block text-[14px] font-medium text-ink">Permisos · datos de salud</span>
      <span className="block text-[12.5px] leading-snug text-ink-muted">
        {given == null
          ? '…'
          : given
            ? 'Nos diste permiso para guardar alergias y salud. Se retira borrando esos datos en «Quién come» o borrando la cuenta.'
            : 'Sin dar. Te lo pedimos la primera vez que apuntes una alergia en «Quién come».'}
      </span>
    </li>
  )
}

/**
 * Web Push opt-in (moved from /profile). The button stays hidden when the
 * browser doesn't support Push (esp. iOS Safari pre-install) or
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is missing at build time. On iOS, the user
 * must "Add to Home Screen" first; we surface a tip line so they don't think
 * the button is broken. "Enviar prueba" and "Reparar service worker" live
 * behind its "···" (PRO-39).
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
        Las notificaciones push no están disponibles en este navegador. En iPhone tienes que añadir la app a inicio
        primero (Compartir → Añadir a pantalla de inicio).
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
          <div className="text-[14px] font-medium text-ink">Notificaciones del móvil</div>
          <div className="mt-1 text-[12px] leading-snug text-ink-muted">
            Llegan aunque la app esté cerrada. Sin WhatsApp, por aquí te llegan los avisos de preparación; con WhatsApp,
            solo si un aviso no puede salir por WhatsApp.{' '}
            {state === 'denied' && (
              <span className="text-terracotta-deep">Has denegado el permiso; cámbialo en los ajustes del navegador.</span>
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

      <MenuSheet open={sheetOpen} onClose={() => setSheetOpen(false)} eyebrow="Notificaciones push" title="Más opciones">
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
