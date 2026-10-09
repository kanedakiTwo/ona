"use client"

import { useState } from "react"
import { api } from "@/lib/api"
import { clearSessionData } from "@/lib/pwa/sessionData"

/**
 * "Borrar mi cuenta" (GDPR art. 17). Asks for the password; the API removes
 * the account and the user's own recipes, hands a shared household to the
 * next member, and disconnects WhatsApp (services/accountDeletion.ts).
 */
export function DeleteAccountCard({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function handleDelete() {
    setBusy(true)
    setError("")
    try {
      await api.delete(`/user/${userId}`, { password })
      localStorage.removeItem("ona_token")
      localStorage.removeItem("ona_user")
      await clearSessionData()
      window.location.assign("/?cuenta=borrada")
    } catch (err: any) {
      setError(err?.message ?? "No se ha podido borrar la cuenta.")
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center text-[13px] text-ink-muted underline underline-offset-4 hover:text-terracotta-deep"
      >
        Borrar mi cuenta
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-border-soft bg-cream p-4 lg:p-5">
      <p className="font-serif-text text-[18px] font-[650] leading-tight text-ink">
        Borrar tu cuenta <span className="font-medium italic text-terracotta-deep">para siempre</span>
      </p>
      <ul className="mt-3 space-y-1.5 text-[13px] leading-snug text-ink-mid">
        <li>— Se borran tu perfil, tus menús, tu memoria, tus recetas propias y tu historial de WhatsApp.</li>
        <li>— Si compartes hogar, el hogar sigue para los demás: pasa a otro miembro con el menú de la semana.</li>
        <li>— No se puede deshacer.</li>
      </ul>
      <label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted" htmlFor="delete-password">
        Escribe tu contraseña para confirmar
      </label>
      <input
        id="delete-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="input-line"
      />
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-terracotta-deep">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={handleDelete}
          disabled={!password || busy}
          className="h-11 rounded-full bg-terracotta-deep px-5 text-[13px] font-medium text-cream transition-colors hover:bg-ink disabled:opacity-50"
        >
          {busy ? "Borrando..." : "Borrar definitivamente"}
        </button>
        <button
          onClick={() => {
            setOpen(false)
            setPassword("")
            setError("")
          }}
          disabled={busy}
          className="inline-flex h-11 items-center px-2 text-[13px] text-ink-muted hover:text-ink"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
