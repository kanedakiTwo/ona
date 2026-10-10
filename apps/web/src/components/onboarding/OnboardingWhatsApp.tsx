"use client"

/**
 * WhatsApp-first sign-up (Miguel, 2026-10-10): the first screen of
 * /onboarding offers to do everything with Mimo in WhatsApp. The user sends
 * a one-time code from their phone (same linking as /whatsapp/conectar: the
 * phone that sends it is the one linked), Mimo asks the first-steps
 * questions in the chat and builds the first menu (`complete_onboarding`).
 * This page polls the account and moves on to /menu once that is done.
 * "Prefiero seguir en la web" keeps the classic five questions.
 */

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { MessageCircle, Monitor } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
import { useWhatsAppStatus, type useWhatsAppLinkCode } from "@/hooks/useWhatsApp"
import { Accent, OnboardingHeader } from "./OnboardingShell"

const PILL =
  "flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-ink px-6 text-[16px] font-semibold text-cream transition-colors hover:bg-ink-mid active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
const LINK =
  "inline-flex min-h-[44px] items-center justify-center px-3 text-[14px] font-medium text-ink-muted underline-offset-4 hover:text-ink hover:underline"
const LEAD = "mt-2 text-[15px] leading-relaxed text-ink-muted"

export function OnboardingChannelChoice({ onWhatsApp, onWeb }: { onWhatsApp: () => void; onWeb: () => void }) {
  return (
    <section data-testid="onboarding-channel">
      <OnboardingHeader eyebrow="Primeros pasos">
        ¿Dónde quieres hablar con <Accent>Mimo</Accent>?
      </OnboardingHeader>
      <p className={LEAD}>Puedes usar las dos cosas; esto es solo por dónde empezamos.</p>
      <div className="mt-6 flex flex-col gap-3">
        <button
          type="button"
          onClick={onWhatsApp}
          className="flex w-full items-start gap-4 rounded-[20px] border border-ink bg-paper p-4 text-left ring-1 ring-ink transition-colors active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-terracotta text-cream" aria-hidden="true">
            <MessageCircle size={20} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-serif-text text-[17px] font-[650] leading-tight text-ink">
              Por WhatsApp <span className="ml-1 align-middle text-[11px] font-semibold uppercase tracking-[0.12em] text-terracotta-deep">Recomendado</span>
            </span>
            <span className="text-[13px] leading-snug text-ink-muted">
              Mimo te hace tres preguntas en el chat y te deja ahí tu primer menú. Luego te escribe cuando toca.
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={onWeb}
          className="flex w-full items-start gap-4 rounded-[20px] border border-border-soft bg-paper p-4 text-left transition-colors hover:border-ink active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream-deep text-ink" aria-hidden="true">
            <Monitor size={19} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="font-serif-text text-[17px] font-[650] leading-tight text-ink">Prefiero la web</span>
            <span className="text-[13px] leading-snug text-ink-muted">Contesta aquí cinco preguntas. Podrás conectar WhatsApp después desde tu perfil.</span>
          </span>
        </button>
      </div>
    </section>
  )
}

/**
 * Code to send from the phone, then "Mimo te está escribiendo" until the first
 * steps are done in the chat. The code is minted by the parent in the click on
 * «Por WhatsApp» (an event, not an effect: under React's dev double-mount the
 * effect version lost the response and stayed on «Preparando tu código…»).
 */
export function OnboardingWhatsAppLink({
  onWeb,
  linkCode,
}: {
  onWeb: () => void
  linkCode: ReturnType<typeof useWhatsAppLinkCode>
}) {
  const { user, updateUser } = useAuth()
  const router = useRouter()
  const status = useWhatsAppStatus({ pollWhilePending: true })
  const linked = Boolean(status.data?.linked)

  // Mimo finishes the first steps in the chat; follow the account until it's onboarded.
  const account = useQuery({
    queryKey: ["user", user?.id, "onboarding"],
    queryFn: () => api.get<any>(`/user/${user!.id}`),
    enabled: Boolean(user?.id) && linked,
    refetchInterval: 4_000,
  })
  useEffect(() => {
    if (account.data?.onboardingDone) {
      updateUser(account.data)
      router.push("/menu")
    }
  }, [account.data, updateUser, router])

  if (linked) {
    return (
      <section data-testid="onboarding-whatsapp-linked">
        <OnboardingHeader eyebrow="Primeros pasos · WhatsApp">
          Mimo te está <Accent>escribiendo</Accent>
        </OnboardingHeader>
        <p className={LEAD}>
          Contesta en WhatsApp sus tres preguntas y te preparará el menú de esta semana. Cuando esté, lo verás también aquí.
        </p>
        <div className="mt-6 flex flex-col items-center gap-2">
          {status.data?.chatLink && (
            <a href={status.data.chatLink} className={PILL}>
              <MessageCircle size={18} aria-hidden="true" /> Abrir WhatsApp
            </a>
          )}
          <p className="text-[13px] text-ink-muted" role="status">
            Esperando a que termines en WhatsApp…
          </p>
          <button type="button" onClick={onWeb} className={LINK}>
            Prefiero seguir en la web
          </button>
        </div>
      </section>
    )
  }

  return (
    <section data-testid="onboarding-whatsapp-code">
      <OnboardingHeader eyebrow="Primeros pasos · WhatsApp">
        Conecta tu <Accent>WhatsApp</Accent>
      </OnboardingHeader>
      <p className={LEAD}>
        Toca el botón: se abre WhatsApp con un mensaje ya escrito. Envíalo y Mimo te hará tres preguntas para tu primer menú.
      </p>
      {linkCode.error ? (
        <div className="mt-6 flex flex-col gap-2">
          <p role="alert" className="rounded-2xl bg-warn-bg p-3 text-[14px] text-terracotta-deep">
            No hemos podido preparar tu código. Inténtalo otra vez o sigue en la web.
          </p>
          <button type="button" onClick={() => linkCode.mutate()} className={PILL}>
            Reintentar
          </button>
        </div>
      ) : !linkCode.data ? (
        <p className="mt-6 text-[14px] text-ink-muted" role="status">
          Preparando tu código…
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          <p
            data-testid="onboarding-whatsapp-message"
            className="rounded-[16px] border border-dashed border-border bg-paper px-4 py-3 font-mono text-[15px] tracking-wide break-words text-ink"
          >
            {linkCode.data.message}
          </p>
          {linkCode.data.waLink ? (
            <a href={linkCode.data.waLink} className={PILL}>
              <MessageCircle size={18} aria-hidden="true" /> Enviar desde WhatsApp
            </a>
          ) : (
            <p className="text-[14px] text-ink-muted">Envía ese mensaje a Mimo desde tu WhatsApp.</p>
          )}
          <p className="text-center text-[13px] text-ink-muted" role="status">
            Esperando tu mensaje… el código caduca en 10 min.
          </p>
        </div>
      )}
      <div className="mt-2 flex justify-center">
        <button type="button" onClick={onWeb} className={LINK}>
          Prefiero seguir en la web
        </button>
      </div>
    </section>
  )
}
