'use client'

/**
 * /profile/casa — Household management.
 *
 * Every authed user has a "primary household" (a solo household auto-created
 * at registration). This page lets the owner rename it, invite people, revoke
 * pending invites, and remove members. Non-owners only see the member list
 * and a "Salir del hogar" button.
 *
 * Scope flip from user_id → household_id for menus/shopping/etc. lands in
 * PR 1 Part B. This page is the visible foundation for that work.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Copy, X, Plus, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

type Role = 'owner' | 'member' | 'child'

interface Member {
  userId: string
  username: string
  role: Role
  joinedAt: string
}

interface PendingInvite {
  id: string
  token: string
  role: Role
  email: string | null
  expiresAt: string
  invitedByUserId: string
}

interface HouseholdView {
  id: string
  name: string
  ownerId: string
  members: Member[]
  pendingInvites: PendingInvite[]
}

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Propietari@',
  member: 'Miembro',
  child: 'Niñ@',
}

export default function HouseholdPage() {
  const { user, isLoading: authLoading } = useAuth()
  const [household, setHousehold] = useState<HouseholdView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [creatingInvite, setCreatingInvite] = useState(false)
  const [newInviteRole, setNewInviteRole] = useState<Role>('member')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<HouseholdView>('/households/me')
      setHousehold(data)
      setNameDraft(data.name)
    } catch (e: any) {
      setError(e?.message ?? 'Error cargando el hogar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && user) {
      void reload()
    }
  }, [authLoading, user, reload])

  const isOwner = !!user && !!household && user.id === household.ownerId

  async function handleRename() {
    if (!household || nameDraft.trim() === household.name) {
      setRenaming(false)
      return
    }
    setBusy(true)
    try {
      const updated = await api.patch<HouseholdView>('/households/me', { name: nameDraft.trim() })
      setHousehold(updated)
      setNameDraft(updated.name)
      setRenaming(false)
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo cambiar el nombre')
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateInvite() {
    setBusy(true)
    setCreatingInvite(false)
    try {
      await api.post<{ token: string; inviteUrl?: string }>('/households/me/invites', {
        role: newInviteRole,
      })
      await reload()
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo crear la invitación')
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(inviteId: string) {
    setBusy(true)
    try {
      await api.post(`/households/me/invites/${inviteId}/revoke`)
      await reload()
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo revocar')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveMember(memberUserId: string) {
    if (!confirm('¿Quitar a esta persona del hogar?')) return
    setBusy(true)
    try {
      await api.post(`/households/me/members/${memberUserId}/remove`)
      await reload()
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo quitar al miembro')
    } finally {
      setBusy(false)
    }
  }

  async function handleLeave() {
    if (!confirm('Si te vas crearemos un hogar nuevo para ti. ¿Continuar?')) return
    setBusy(true)
    try {
      await api.post('/households/me/leave')
      await reload()
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo salir')
    } finally {
      setBusy(false)
    }
  }

  function copyInviteUrl(token: string) {
    const url = `${window.location.origin}/invites/${token}`
    void navigator.clipboard.writeText(url).catch(() => {})
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE]">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  if (!household) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE]">
        <div className="text-eyebrow">No tienes un hogar asignado.</div>
      </div>
    )
  }

  return (
    <div className="bg-[#FAF6EE] min-h-screen pb-24">
      <header className="px-5 pt-8 pb-6">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-eyebrow text-[#7A7066] hover:text-[#C65D38]"
        >
          <ChevronLeft size={14} /> Volver al perfil
        </Link>
        <div className="mt-3 text-eyebrow">Tu hogar</div>
        <h1 className="font-display text-[2.2rem] leading-[0.95] text-[#1A1612] mt-1">
          {renaming ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void handleRename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename()
                if (e.key === 'Escape') {
                  setNameDraft(household.name)
                  setRenaming(false)
                }
              }}
              className="font-display text-[2.2rem] leading-[0.95] bg-transparent border-b border-[#1A1612] text-[#1A1612] outline-none w-full"
              maxLength={60}
            />
          ) : (
            <button
              type="button"
              onClick={() => isOwner && setRenaming(true)}
              className={`font-display text-[2.2rem] leading-[0.95] text-[#1A1612] text-left ${
                isOwner ? 'hover:text-[#C65D38] cursor-text' : 'cursor-default'
              }`}
            >
              {household.name}
            </button>
          )}
        </h1>
      </header>

      {error && (
        <div className="mx-5 mb-4 rounded-xl bg-[#C65D38]/10 border border-[#C65D38]/30 px-4 py-3 text-[12px] text-[#C65D38]">
          {error}
        </div>
      )}

      {/* Members */}
      <section className="px-5">
        <div className="text-eyebrow mb-3">Miembros · {household.members.length}</div>
        <ul className="divide-y divide-[#DDD6C5] rounded-2xl bg-[#FFFEFA] border border-[#DDD6C5]">
          {household.members.map((m) => {
            const isMe = m.userId === user?.id
            return (
              <li key={m.userId} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F2EDE0] text-[13px] font-medium text-[#1A1612]">
                  {m.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] text-[#1A1612] truncate">
                    {m.username}{isMe && <span className="ml-1.5 text-[#7A7066] text-[11px]">(tú)</span>}
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
                    {ROLE_LABELS[m.role]}
                  </div>
                </div>
                {isOwner && !isMe && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveMember(m.userId)}
                    disabled={busy}
                    className="rounded-full border border-[#DDD6C5] px-3 py-1 text-[10px] uppercase tracking-[0.1em] text-[#7A7066] hover:border-[#C65D38] hover:text-[#C65D38] disabled:opacity-40"
                  >
                    Quitar
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      {/* Invites — owner only */}
      {isOwner && (
        <section className="px-5 mt-10">
          <div className="text-eyebrow mb-3">Invitaciones pendientes</div>
          {household.pendingInvites.length === 0 ? (
            <p className="text-[12px] text-[#7A7066] mb-3">
              Aún no hay invitaciones activas.
            </p>
          ) : (
            <ul className="divide-y divide-[#DDD6C5] rounded-2xl bg-[#FFFEFA] border border-[#DDD6C5] mb-3">
              {household.pendingInvites.map((inv) => {
                const inviteUrl =
                  typeof window !== 'undefined'
                    ? `${window.location.origin}/invites/${inv.token}`
                    : `/invites/${inv.token}`
                return (
                  <li key={inv.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] text-[#1A1612]">
                        <span className="font-medium">{ROLE_LABELS[inv.role]}</span>
                        {inv.email && <span className="text-[#7A7066]"> · {inv.email}</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRevoke(inv.id)}
                        disabled={busy}
                        aria-label="Revocar invitación"
                        className="rounded-full border border-[#DDD6C5] p-1.5 text-[#7A7066] hover:border-[#C65D38] hover:text-[#C65D38] disabled:opacity-40"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#F2EDE0] px-3 py-2">
                      <code className="flex-1 truncate text-[11px] text-[#1A1612]">
                        {inviteUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyInviteUrl(inv.token)}
                        aria-label="Copiar enlace"
                        className="rounded-full border border-[#DDD6C5] bg-[#FFFEFA] p-1.5 text-[#7A7066] hover:border-[#1A1612] hover:text-[#1A1612]"
                      >
                        <Copy size={11} />
                      </button>
                    </div>
                    <div className="mt-1.5 text-[10px] text-[#A39A8E]">
                      Caduca {new Date(inv.expiresAt).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: 'short',
                      })}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {creatingInvite ? (
            <div className="rounded-2xl bg-[#FFFEFA] border border-[#DDD6C5] p-4">
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066] mb-2">Rol</div>
              <div className="flex gap-2">
                {(['member', 'child'] as Role[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setNewInviteRole(r)}
                    className={`flex-1 rounded-full border px-3 py-2 text-[12px] ${
                      newInviteRole === r
                        ? 'border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]'
                        : 'border-[#DDD6C5] bg-transparent text-[#7A7066]'
                    }`}
                  >
                    {ROLE_LABELS[r]}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setCreatingInvite(false)}
                  className="flex-1 rounded-full border border-[#DDD6C5] py-2 text-[12px] text-[#7A7066] hover:text-[#1A1612]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void handleCreateInvite()}
                  disabled={busy}
                  className="flex-1 rounded-full bg-[#1A1612] py-2 text-[12px] text-[#FAF6EE] disabled:opacity-50"
                >
                  Crear invitación
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreatingInvite(true)}
              className="inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] hover:bg-[#2D6A4F]"
            >
              <Plus size={12} /> Invitar a alguien
            </button>
          )}
        </section>
      )}

      {/* Leave — for everyone (even sole owner can leave; the API auto-creates a new solo) */}
      <section className="px-5 mt-12">
        <button
          type="button"
          onClick={() => void handleLeave()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full border border-[#C65D38]/40 px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-[#C65D38] hover:bg-[#C65D38] hover:text-[#FAF6EE] disabled:opacity-40"
        >
          <LogOut size={11} /> Salir del hogar
        </button>
        <p className="mt-2 text-[11px] text-[#7A7066]">
          Si eres el único miembro, se mantendrá tu hogar. Si hay más miembros,
          el siguiente más antiguo pasará a ser propietari@.
        </p>
      </section>
    </div>
  )
}
