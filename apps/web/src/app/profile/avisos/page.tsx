"use client"

/**
 * /profile/avisos — «Avisos» (PRO-237, D-080; specs/notifications.md).
 *
 * One row per kind of alert Mimo sends first: what it is, by where it
 * arrives (WhatsApp, the phone notification, or it doesn't) and a switch.
 * One channel per alert (PRO-234): WhatsApp when it's connected with avisos;
 * without it only the prep alerts go by the phone notification. Email only
 * carries the account and the Friday menu. Mimo can read and change the same
 * switches (`get_alerts` / `set_alerts`), in the web chat and on WhatsApp.
 * PRO-1301: the household's time for the morning menu and the dinner
 * question (Mimo: `set_alert_time`).
 */
import { useEffect, useState } from "react"
import Link from "next/link"
import { Bell, CalendarCheck, Mail, MessageCircle, Smartphone } from "lucide-react"
import { ALERT_TIME_KINDS, ALERT_TIME_RANGE, type AlertRow, type AlertsOverview, type AlertTimeKind } from "@ona/shared"
import { useAlerts, useSetAlert, useSetAlertTime } from "@/hooks/useAlerts"
import { Accent, SUB_CARD, SUB_EYEBROW, SUB_LIST, SubPage } from "@/components/profile/SubPage"
import { SubLoadError, useQueryLoad } from "@/components/profile/SubLoadError"
import { Switch } from "@/app/profile/sections/ProfileCards"
import { NewsletterToggle } from "@/components/profile/NewsletterToggle"

const CHANNEL_LABEL: Record<AlertRow["channel"], string> = {
  whatsapp: "Por WhatsApp",
  push: "Notificación del móvil",
  email: "Por correo",
  app: "En tu menú, en la app",
  off: "No te llega",
}

function ChannelIcon({ channel }: { channel: AlertRow["channel"] }) {
  const Icon =
    channel === "whatsapp" ? MessageCircle : channel === "push" ? Smartphone : channel === "email" ? Mail : channel === "app" ? CalendarCheck : Bell
  return <Icon size={14} strokeWidth={1.8} aria-hidden="true" className="shrink-0" />
}

function channelLine(row: AlertRow): string {
  if (!row.on) return "Apagado"
  if (row.channel === "off") return row.note ?? CHANNEL_LABEL.off
  return row.fallback ? `${CHANNEL_LABEL[row.channel]} · si no sale, notificación del móvil` : CHANNEL_LABEL[row.channel]
}

const TIME_LABEL: Record<AlertTimeKind, string> = {
  daily_brief: "Menú del día",
  dinner_checkin: "¿Hiciste la cena?",
}

function AlertTimeRow({ kind, data }: { kind: AlertTimeKind; data: AlertsOverview }) {
  const saved = data.times[kind]
  const setTime = useSetAlertTime()
  const [value, setValue] = useState(saved.time)
  useEffect(() => setValue(saved.time), [saved.time])
  const changed = value !== saved.time
  const { min, max } = ALERT_TIME_RANGE[kind]
  return (
    <li className="px-4 py-3" data-testid={`alert-time-${kind}`}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`alert-time-${kind}-input`} className="min-w-0">
          <span className="block text-[15px] font-medium text-ink">{TIME_LABEL[kind]}</span>
          <span className="block text-[12px] leading-snug text-ink-muted" data-testid={`alert-time-${kind}-note`}>
            {saved.custom ? "La hora que elegisteis." : "La de siempre."} Entre las {min} y las {max}.
          </span>
        </label>
        <input
          id={`alert-time-${kind}-input`}
          type="time"
          min={min}
          max={max}
          step={300}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-[44px] w-[112px] shrink-0 rounded-xl border border-border-soft bg-paper px-3 text-[15px] text-ink focus:border-ink focus:outline-none"
        />
      </div>
      {(changed || saved.custom) && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
          {saved.custom && !changed && (
            <button
              type="button"
              disabled={setTime.isPending}
              onClick={() => setTime.mutate({ kind, time: null })}
              className="text-[13px] font-medium text-ink-mid underline underline-offset-2 disabled:opacity-60"
            >
              Volver a la de siempre
            </button>
          )}
          {changed && (
            <button
              type="button"
              data-testid={`alert-time-${kind}-save`}
              disabled={setTime.isPending || !value}
              onClick={() => setTime.mutate({ kind, time: value })}
              className="min-h-[36px] rounded-full bg-ink px-4 text-[13px] font-medium text-cream disabled:opacity-40"
            >
              Guardar
            </button>
          )}
        </div>
      )}
      {setTime.isError && (
        <p role="alert" className="mt-2 text-[13px] text-terracotta-deep">
          {setTime.error instanceof Error && setTime.error.message ? setTime.error.message : "No se ha podido guardar. Inténtalo otra vez."}
        </p>
      )}
    </li>
  )
}

export default function AvisosPage() {
  const alerts = useAlerts()
  const setAlert = useSetAlert()
  const load = useQueryLoad([["alerts"], alerts])
  const data = alerts.data

  return (
    <SubPage
      eyebrow="Avisos"
      back={{ href: "/profile/ajustes", label: "Ajustes" }}
      title={
        <>
          Qué te llega y <Accent>por dónde</Accent>
        </>
      }
      intro="Cada aviso llega por un solo sitio: por WhatsApp si lo tienes conectado; si no, los de preparación como notificación del móvil. También puedes pedírselo a Mimo: «no me mandes el menú del día» o «mándamelo a las 8»."
    >
      {load.failed ? (
        <SubLoadError onRetry={load.retry} retrying={load.retrying} />
      ) : !data ? (
        <div className="animate-pulse space-y-3" aria-hidden="true">
          <div className="h-64 rounded-[20px] bg-bone" />
        </div>
      ) : (
        <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
          <section>
            <h2 className={SUB_EYEBROW}>Avisos de Mimo</h2>
            <ul className={`${SUB_LIST} mt-3`} data-testid="alerts-list">
              {data.kinds.map((row) => (
                <li key={row.kind}>
                  <button
                    type="button"
                    data-testid={`alert-${row.kind}`}
                    aria-pressed={row.on}
                    disabled={setAlert.isPending}
                    onClick={() => setAlert.mutate({ kind: row.kind, on: !row.on })}
                    className="flex min-h-[64px] w-full items-center justify-between gap-3 px-4 py-3 text-left disabled:opacity-60"
                  >
                    <div className="min-w-0">
                      <div className="text-[15px] font-medium text-ink">{row.title}</div>
                      <div className="text-[12px] leading-snug text-ink-muted">{row.description}</div>
                      <div
                        data-testid={`alert-${row.kind}-channel`}
                        className={`mt-1 flex items-center gap-1.5 text-[12px] font-medium ${row.on && row.channel !== "off" ? "text-ink-mid" : "text-ink-light"}`}
                      >
                        <ChannelIcon channel={row.on ? row.channel : "off"} />
                        <span>{channelLine(row)}</span>
                      </div>
                    </div>
                    <Switch on={row.on} />
                  </button>
                </li>
              ))}
            </ul>
            {setAlert.isError && (
              <p role="alert" className="mt-3 text-[13px] text-terracotta-deep">
                No se ha podido guardar. Inténtalo otra vez.
              </p>
            )}
            {data.times && (
              <>
                <h2 className={`${SUB_EYEBROW} mt-8`}>A qué hora</h2>
                <p className="mt-1 text-[12px] leading-snug text-ink-muted">Para toda la casa.</p>
                <ul className={`${SUB_LIST} mt-3`} data-testid="alert-times">
                  {ALERT_TIME_KINDS.map((kind) => (
                    <AlertTimeRow key={kind} kind={kind} data={data} />
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="space-y-6">
            <div>
              <h2 className={SUB_EYEBROW}>Canales</h2>
              <div className={`${SUB_CARD} mt-3 space-y-2 p-4 text-[13px] leading-snug text-ink-mid`} data-testid="alerts-channels">
                <p>
                  <strong className="font-medium text-ink">WhatsApp:</strong>{" "}
                  {data.whatsapp.linked
                    ? data.whatsapp.notify
                      ? "conectado, con avisos."
                      : "conectado, con los avisos apagados."
                    : "sin conectar."}
                </p>
                <p>
                  <strong className="font-medium text-ink">Notificaciones del móvil:</strong>{" "}
                  {data.push.subscribed ? "activadas." : "sin activar."}
                </p>
                <Link href="/profile/ajustes" className="inline-block pt-1 text-[13px] font-medium text-ink underline underline-offset-2">
                  Cambiarlos en Ajustes
                </Link>
              </div>
            </div>
            <div>
              <h2 className={SUB_EYEBROW}>Por correo</h2>
              <div className={`${SUB_CARD} mt-3 p-4`}>
                <p className="text-[13px] leading-snug text-ink-mid">
                  Por correo solo te llega lo de tu cuenta: la bienvenida, la contraseña, las invitaciones, el final de tu
                  prueba y el aviso antes del primer cobro. Y, si quieres, el menú de los viernes:
                </p>
                <NewsletterToggle />
              </div>
            </div>
          </section>
        </div>
      )}
    </SubPage>
  )
}
