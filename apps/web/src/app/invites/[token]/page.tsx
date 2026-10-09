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
import { Accent, AUTH_PILL, AUTH_TITLE, AuthHeading, AuthShell } from '@/components/auth/AuthShell'

const HERO_IMG = 'https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=1200&q=85&auto=format&fit=crop'

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
      <AuthShell image={HERO_IMG}>
        <p role="status" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
          Cargando invitación…
        </p>
      </AuthShell>
    )
  }

  if (error || !preview) {
    return (
      <AuthShell image={HERO_IMG}>
        <h1 className={AUTH_TITLE}>Invitación no válida</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-mid">{error ?? 'El enlace ha caducado o ya se usó.'}</p>
        <a href="/menu" className={`mt-7 ${AUTH_PILL}`}>
          Ir a Mimoia
        </a>
      </AuthShell>
    )
  }

  return (
    <AuthShell image={HERO_IMG}>
      <AuthHeading
        eyebrow="Invitación"
        title={
          <>
            <Accent>{preview.invitedByUsername}</Accent> te invita a unirte a{' '}
            <span className="italic">{preview.householdName}</span>
          </>
        }
        lead={
          <>
            Te unirás como <strong className="font-semibold text-ink">{ROLE_COPY[preview.role]}</strong>. Compartiréis
            menús, lista de la compra y despensa.
          </>
        }
      />

      <button type="button" onClick={() => void handleAccept()} disabled={accepting} className={`mt-7 ${AUTH_PILL}`}>
        {accepting ? 'Aceptando…' : user ? 'Aceptar invitación' : 'Crear cuenta y aceptar'}
      </button>

      {user && (
        <a
          href="/menu"
          className="mt-2 flex min-h-[44px] items-center justify-center text-[13px] font-medium text-ink-muted hover:text-ink"
        >
          Más tarde
        </a>
      )}
    </AuthShell>
  )
}
