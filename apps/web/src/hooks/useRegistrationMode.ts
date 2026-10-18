"use client"

/**
 * The registration mode the public web follows (PRO-167, specs/waitlist.md
 * «Open registration»): `GET /public/config` once per page load. Until it
 * answers — or if it fails — the web behaves as today (`invite`: the
 * waitlist), so a hiccup never hides the way in.
 */
import { useEffect, useState } from "react"
import { OPEN_SIGNUP_CTA_LABEL, openRegistrationHref, type PublicConfig, type RegistrationMode } from "@ona/shared"
import { apiPublic } from "@/lib/api"

let cached: Promise<RegistrationMode> | null = null

function loadMode(): Promise<RegistrationMode> {
  if (!cached) {
    cached = apiPublic
      .get<PublicConfig>("/public/config")
      .then((c) => (c?.registration === "open" ? "open" : "invite") as RegistrationMode)
      .catch(() => {
        cached = null
        return "invite" as RegistrationMode
      })
  }
  return cached
}

export function useRegistrationMode(): RegistrationMode {
  const [mode, setMode] = useState<RegistrationMode>("invite")
  useEffect(() => {
    let alive = true
    loadMode().then((m) => {
      if (alive) setMode(m)
    })
    return () => {
      alive = false
    }
  }, [])
  return mode
}

/**
 * A public call to action: with open registration, «Crea tu cuenta gratis» →
 * `/register` with this page's `?ref` (else `ref`), `?invita` and `utm_*`;
 * otherwise the waitlist link and label it was given.
 */
export function useSignupCta(waitlistHref: string, waitlistLabel: string, ref: string | null) {
  const mode = useRegistrationMode()
  const [search, setSearch] = useState("")
  useEffect(() => setSearch(window.location.search), [])
  return mode === "open"
    ? { open: true, href: openRegistrationHref(ref, search), label: OPEN_SIGNUP_CTA_LABEL }
    : { open: false, href: waitlistHref, label: waitlistLabel }
}
