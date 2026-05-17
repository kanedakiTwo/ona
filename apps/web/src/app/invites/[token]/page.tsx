'use client'

/**
 * /invites/[token] — public invite preview + accept.
 *
 * The preview is public (the recipient may not have an account yet). The
 * accept call requires auth — if the user isn't logged in, we send them to
 * /register?next=/invites/<token>, and `useAuth` brings them back here.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

interface InvitePreview {
  householdName: string
  invitedByUsername: string
  role: 'owner' | 'member' | 'child'
}

const ROLE_COPY: Record<InvitePreview['role'], string> = {
  owner: 'propietari@',
  member: 'miembro',
  child: 'niñ@',
}

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>()
  const router = useRouter()
  const token = String(params?.token ?? '')
  const { user, isLoading: authLoading } = useAuth()

  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)

  const loadPreview = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<InvitePreview>(`/invites/${token}`)
      setPreview(data)
    } catch (e: any) {
      setError(e?.message ?? 'La invitación no es válida.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) void loadPreview()
  }, [token, loadPreview])

  async function handleAccept() {
    if (!user) {
      router.push(`/register?next=/invites/${encodeURIComponent(token)}`)
      return
    }
    setAccepting(true)
    setError(null)
    try {
      await api.post(`/invites/${token}/accept`)
      router.push('/profile/casa')
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo aceptar la invitación.')
      setAccepting(false)
    }
  }

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE]">
        <div className="text-eyebrow">Cargando invitación…</div>
      </div>
    )
  }

  if (error || !preview) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#FAF6EE] px-6 text-center">
        <div className="font-display text-2xl text-[#1A1612]">Invitación no válida</div>
        <p className="text-[13px] text-[#7A7066] max-w-xs">
          {error ?? 'El enlace ha caducado o ya se usó.'}
        </p>
        <a
          href="/menu"
          className="mt-3 rounded-full bg-[#1A1612] px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE]"
        >
          Ir a ONA
        </a>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#FAF6EE] px-6 text-center">
      <div className="text-eyebrow">Invitación</div>
      <h1 className="font-display text-[2rem] leading-[1.05] text-[#1A1612] max-w-sm">
        <span className="italic text-[#C65D38]">{preview.invitedByUsername}</span>
        <br />te invita a unirte a{' '}
        <span className="italic">{preview.householdName}</span>
      </h1>
      <p className="text-[13px] text-[#7A7066]">
        Te uniras como <strong>{ROLE_COPY[preview.role]}</strong>.
        Compartireis menús, lista de la compra y despensa.
      </p>

      <button
        type="button"
        onClick={() => void handleAccept()}
        disabled={accepting}
        className="mt-4 inline-flex items-center justify-center rounded-full bg-[#1A1612] px-8 py-3 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] hover:bg-[#2D6A4F] disabled:opacity-50"
      >
        {accepting ? 'Aceptando…' : user ? 'Aceptar invitación' : 'Crear cuenta y aceptar'}
      </button>

      {user && (
        <a href="/menu" className="text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]">
          Más tarde
        </a>
      )}
    </div>
  )
}
