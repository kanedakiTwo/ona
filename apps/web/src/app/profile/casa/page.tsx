'use client'

/**
 * /profile/casa — Household management.
 *
 * Every authed user has a "primary household" (a solo household auto-created
 * at registration). This page lets the owner rename it, invite people, revoke
 * pending invites, and remove members. Non-owners only see the member list
 * and a "Salir del hogar" action.
 *
 * Skin: "D · Luz y foto" (PRO-40). Secondary actions live in "···" sheets:
 * the header one (Cambiar nombre, Salir del hogar), one per member (Quitar
 * del hogar) and one per invite (Revocar invitación). Copying an invite link
 * and creating an invite stay inline.
 */

import { useCallback, useEffect, useState } from 'react'
import { Copy, Plus, LogOut, Pencil, UserMinus, XCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { MenuSheet, SheetAction } from '@/components/menu/MenuSheet'
import {
  MoreButton,
  PILL_INK,
  PILL_OUTLINE,
  SUB_CARD,
  SUB_EYEBROW,
  SUB_LIST,
  SubPage,
} from '@/components/profile/SubPage'

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

type SheetState =
  | { kind: 'household' }
  | { kind: 'member'; member: Member }
  | { kind: 'invite'; invite: PendingInvite }
  | null

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
  const [sheet, setSheet] = useState<SheetState>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

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
    void navigator.clipboard
      .writeText(url)
      .then(() => setCopiedToken(token))
      .catch(() => {})
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  if (!household) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="text-eyebrow">No tienes un hogar asignado.</div>
      </div>
    )
  }

  const title = renaming ? (
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
      aria-label="Nombre del hogar"
      className="w-full border-b-2 border-ink bg-transparent font-serif-text font-[650] text-ink outline-none"
      maxLength={60}
    />
  ) : (
    <button
      type="button"
      onClick={() => isOwner && setRenaming(true)}
      className={`text-left ${isOwner ? 'cursor-text hover:text-terracotta-deep' : 'cursor-default'}`}
    >
      {household.name}
    </button>
  )

  return (
    <SubPage
      eyebrow="Tu hogar"
      title={title}
      action={<MoreButton label="Opciones del hogar" onClick={() => setSheet({ kind: 'household' })} />}
    >
      {error && (
        <div
          role="alert"
          className="mb-5 rounded-2xl border border-terracotta-deep/25 bg-warn-bg px-4 py-3 text-[14px] text-terracotta-deep"
        >
          {error}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-10">
        {/* Members */}
        <section>
          <h2 className={`${SUB_EYEBROW} mb-3`}>Miembros · {household.members.length}</h2>
          <ul className={SUB_LIST}>
            {household.members.map((m) => {
              const isMe = m.userId === user?.id
              return (
                <li key={m.userId} className="flex min-h-[64px] items-center gap-3 py-2 pl-4 pr-2">
                  <div
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bone font-serif-text text-[16px] font-[650] text-ink"
                  >
                    {m.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium text-ink">
                      {m.username}
                      {isMe && <span className="ml-1.5 text-[13px] font-normal text-ink-muted">(tú)</span>}
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                      {ROLE_LABELS[m.role]}
                    </div>
                  </div>
                  {isOwner && !isMe && (
                    <MoreButton
                      label={`Opciones de ${m.username}`}
                      onClick={() => setSheet({ kind: 'member', member: m })}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {/* Invites — owner only */}
        {isOwner && (
          <section>
            <h2 className={`${SUB_EYEBROW} mb-3`}>Invitaciones pendientes</h2>
            {household.pendingInvites.length === 0 ? (
              <p className="mb-4 text-[14px] text-ink-soft">Aún no hay invitaciones activas.</p>
            ) : (
              <ul className={`${SUB_LIST} mb-4`}>
                {household.pendingInvites.map((inv) => {
                  const inviteUrl =
                    typeof window !== 'undefined'
                      ? `${window.location.origin}/invites/${inv.token}`
                      : `/invites/${inv.token}`
                  return (
                    <li key={inv.id} className="py-2 pl-4 pr-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 text-[14px] text-ink">
                          <span className="font-medium">{ROLE_LABELS[inv.role]}</span>
                          {inv.email && <span className="text-ink-muted"> · {inv.email}</span>}
                          <span className="ml-2 text-[12px] text-ink-muted">
                            Caduca{' '}
                            {new Date(inv.expiresAt).toLocaleDateString('es-ES', {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </span>
                        </div>
                        <MoreButton
                          label="Opciones de la invitación"
                          onClick={() => setSheet({ kind: 'invite', invite: inv })}
                        />
                      </div>
                      <div className="mb-2 mr-2 mt-1 flex items-center gap-1 rounded-xl bg-cream-deep pl-3">
                        <code className="min-w-0 flex-1 truncate text-[12px] text-ink">{inviteUrl}</code>
                        <button
                          type="button"
                          onClick={() => copyInviteUrl(inv.token)}
                          aria-label="Copiar enlace"
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-mid transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
                        >
                          <Copy size={16} />
                        </button>
                      </div>
                      {copiedToken === inv.token && (
                        <p role="status" className="mb-2 text-[12px] text-ink-muted">
                          Enlace copiado.
                        </p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {creatingInvite ? (
              <div className={`${SUB_CARD} p-4`}>
                <div className={`${SUB_EYEBROW} mb-2`}>Rol</div>
                <div className="flex gap-2">
                  {(['member', 'child'] as Role[]).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setNewInviteRole(r)}
                      aria-pressed={newInviteRole === r}
                      className={`min-h-[44px] flex-1 rounded-full border px-3 text-[14px] transition-colors ${
                        newInviteRole === r
                          ? 'border-ink bg-ink text-cream'
                          : 'border-border bg-paper text-ink-mid hover:bg-cream-deep'
                      }`}
                    >
                      {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => setCreatingInvite(false)} className={`${PILL_OUTLINE} flex-1`}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateInvite()}
                    disabled={busy}
                    className={`${PILL_INK} flex-1`}
                  >
                    Crear invitación
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setCreatingInvite(true)} className={PILL_INK}>
                <Plus size={16} /> Invitar a alguien
              </button>
            )}
          </section>
        )}
      </div>

      {/* Household "···": rename (owner) + leave (everyone — even a sole
          owner can leave; the API auto-creates a new solo household). */}
      <MenuSheet
        open={sheet?.kind === 'household'}
        onClose={() => setSheet(null)}
        eyebrow="Tu hogar"
        title={household.name}
      >
        <div className="flex flex-col gap-1">
          {isOwner && (
            <SheetAction
              icon={Pencil}
              label="Cambiar nombre"
              hint="También puedes tocar el nombre arriba."
              onClick={() => {
                setSheet(null)
                setRenaming(true)
              }}
            />
          )}
          <SheetAction
            icon={LogOut}
            label="Salir del hogar"
            hint="Si eres el único miembro, se mantendrá tu hogar. Si hay más miembros, el siguiente más antiguo pasará a ser propietari@."
            destructive
            disabled={busy}
            onClick={() => {
              setSheet(null)
              void handleLeave()
            }}
          />
        </div>
      </MenuSheet>

      <MenuSheet
        open={sheet?.kind === 'member'}
        onClose={() => setSheet(null)}
        eyebrow="Miembro"
        title={sheet?.kind === 'member' ? sheet.member.username : ''}
      >
        {sheet?.kind === 'member' && (
          <SheetAction
            icon={UserMinus}
            label="Quitar del hogar"
            destructive
            disabled={busy}
            onClick={() => {
              const id = sheet.member.userId
              setSheet(null)
              void handleRemoveMember(id)
            }}
          />
        )}
      </MenuSheet>

      <MenuSheet
        open={sheet?.kind === 'invite'}
        onClose={() => setSheet(null)}
        eyebrow="Invitación"
        title={sheet?.kind === 'invite' ? ROLE_LABELS[sheet.invite.role] : ''}
      >
        {sheet?.kind === 'invite' && (
          <SheetAction
            icon={XCircle}
            label="Revocar invitación"
            hint="El enlace dejará de funcionar."
            destructive
            disabled={busy}
            onClick={() => {
              const id = sheet.invite.id
              setSheet(null)
              void handleRevoke(id)
            }}
          />
        )}
      </MenuSheet>
    </SubPage>
  )
}
