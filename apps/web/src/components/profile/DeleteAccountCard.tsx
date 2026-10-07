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
        className="text-[12px] text-[#7A7066] underline underline-offset-4 hover:text-[#B5451B]"
      >
        Borrar mi cuenta
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-[#E8C9BC] bg-[#FFFEFA] p-5">
      <p className="font-display text-lg text-[#1A1612]">
        Borrar tu cuenta <span className="font-italic italic text-[#B5451B]">para siempre</span>
      </p>
      <ul className="mt-3 space-y-1.5 text-[13px] text-[#4A4239]">
        <li>— Se borran tu perfil, tus menús, tu memoria, tus recetas propias y tu historial de WhatsApp.</li>
        <li>— Si compartes hogar, el hogar sigue para los demás: pasa a otro miembro con el menú de la semana.</li>
        <li>— No se puede deshacer.</li>
      </ul>
      <label className="mt-4 block text-[11px] uppercase tracking-[0.12em] text-[#7A7066]" htmlFor="delete-password">
        Escribe tu contraseña para confirmar
      </label>
      <input
        id="delete-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="input-editorial"
      />
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-[#B5451B]">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={handleDelete}
          disabled={!password || busy}
          className="rounded-full bg-[#B5451B] px-5 py-2.5 text-[13px] font-medium text-[#FAF6EE] transition-colors hover:bg-[#8F3514] disabled:opacity-50"
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
          className="text-[12px] text-[#7A7066] hover:text-[#1A1612]"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
