"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { NO_HEALTH_DATA_NOTICE, type HealthConsentState } from "@ona/shared"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"

const SEEN_KEY = "ona.health.notice.seen"

/**
 * Without the health-data consent (PRO-21) Mimoia doesn't know the user's
 * allergies, so /menu says so once: "No tenemos tus alergias: revisa los
 * ingredientes de cada receta". Shown a single time per device.
 */
export function NoHealthDataNotice() {
  const { user } = useAuth()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    let seen = false
    try {
      seen = localStorage.getItem(SEEN_KEY) === "1"
    } catch {}
    if (seen) return
    let cancelled = false
    api
      .get<HealthConsentState>(`/user/${user.id}/health-consent`)
      .then((s) => {
        if (cancelled || !s || s.active || s.needsPrompt) return
        setShow(true)
        try {
          localStorage.setItem(SEEN_KEY, "1")
        } catch {}
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.id])

  if (!show) return null
  return (
    <div
      role="status"
      data-testid="no-health-data-notice"
      className="mx-5 mt-3 flex items-start gap-3 rounded-2xl border border-[#E8C9BB] bg-[#FDF3EE] px-4 py-3 text-[13px] text-[#1A1612] lg:mx-0"
    >
      <p className="flex-1">
        {NO_HEALTH_DATA_NOTICE}.{" "}
        <Link href="/profile" className="underline">
          Añadirlas en tu perfil
        </Link>
      </p>
      <button type="button" onClick={() => setShow(false)} className="text-[12px] font-semibold text-[#7A7066]">
        Entendido
      </button>
    </div>
  )
}
