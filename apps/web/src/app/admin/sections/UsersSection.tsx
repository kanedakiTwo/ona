"use client"

/**
 * UsersSection — admin user management tab.
 *
 * Search + paginated list (25/page). Click a row → side panel with full
 * detail (onboarding answers, counts, physical profile, household) and
 * action buttons:
 *   - Suspender / Reactivar
 *   - Generar enlace de reset (modal with the magic link)
 *
 * Spec: ../../../../specs/user-management.md
 */

import { useEffect, useMemo, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Search,
  X,
} from "lucide-react"
import {
  useAdminResetPasswordToken,
  useAdminSuspendUser,
  useAdminUnsuspendUser,
  useAdminUserDetail,
  useAdminUsersList,
  type AdminUserRow,
  type AdminResetTokenResponse,
} from "@/hooks/useAdmin"

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const sec = Math.round(diff / 1000)
  if (sec < 60) return "ahora mismo"
  const min = Math.round(sec / 60)
  if (min < 60) return `hace ${min} min`
  const hr = Math.round(min / 60)
  if (hr < 24) return `hace ${hr} h`
  const day = Math.round(hr / 24)
  if (day < 30) return `hace ${day} d`
  const month = Math.round(day / 30)
  if (month < 12) return `hace ${month} mes${month === 1 ? "" : "es"}`
  const year = Math.round(month / 12)
  return `hace ${year} año${year === 1 ? "" : "s"}`
}

function formatSpanishDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function UsersSection() {
  const [searchInput, setSearchInput] = useState("")
  const search = useDebounced(searchInput, 300)
  const [onlySuspended, setOnlySuspended] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Reset to page 1 whenever filters change.
  useEffect(() => {
    setPage(1)
  }, [search, onlySuspended])

  const list = useAdminUsersList({
    search: search || undefined,
    suspended: onlySuspended ? true : undefined,
    page,
    perPage: 25,
  })

  const totalPages = useMemo(() => {
    if (!list.data) return 1
    return Math.max(1, Math.ceil(list.data.total / list.data.perPage))
  }, [list.data])

  return (
    <div>
      {/* Filter strip */}
      <div className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#A39A8E]"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por usuario o email…"
              className="w-full rounded-full border border-[#DDD6C5] bg-[#FAF6EE] py-2 pl-9 pr-3 text-[13px] text-[#1A1612] placeholder:text-[#A39A8E] focus:border-[#1A1612] focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 px-2 text-[12px] text-[#4A4239]">
            <input
              type="checkbox"
              checked={onlySuspended}
              onChange={(e) => setOnlySuspended(e.target.checked)}
              className="h-4 w-4 accent-[#C65D38]"
            />
            Solo suspendidos
          </label>
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA]">
        {list.isLoading && (
          <div className="px-4 py-6 text-[12px] italic text-[#7A7066]">
            Cargando usuarios…
          </div>
        )}

        {!list.isLoading && list.data && list.data.rows.length === 0 && (
          <div className="px-4 py-8 text-center text-[12px] italic text-[#7A7066]">
            Sin resultados.
          </div>
        )}

        {!list.isLoading &&
          list.data &&
          list.data.rows.map((row, idx) => (
            <UserRow
              key={row.id}
              row={row}
              first={idx === 0}
              onClick={() => setSelectedId(row.id)}
            />
          ))}
      </div>

      {/* Pager */}
      {list.data && list.data.total > 0 && (
        <div className="mt-3 flex items-center justify-between">
          <div className="text-[11px] text-[#7A7066]">
            {list.data.total} usuario{list.data.total === 1 ? "" : "s"} ·
            página {list.data.page} de {totalPages}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#DDD6C5] bg-[#FFFEFA] text-[#4A4239] disabled:opacity-30"
              aria-label="Página anterior"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#DDD6C5] bg-[#FFFEFA] text-[#4A4239] disabled:opacity-30"
              aria-label="Página siguiente"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {selectedId && (
        <UserSidePanel
          userId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

function UserRow({
  row,
  first,
  onClick,
}: {
  row: AdminUserRow
  first: boolean
  onClick: () => void
}) {
  const initials = (row.username || row.email || "?")
    .charAt(0)
    .toUpperCase()
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#FAF6EE] ${
        first ? "" : "border-t border-[#DDD6C5]"
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1A1612] font-display text-sm text-[#FAF6EE]">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-[#1A1612]">
            {row.username}
          </span>
          {row.role === "admin" && (
            <span className="rounded-full bg-[#C65D38] px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[#FAF6EE]">
              Admin
            </span>
          )}
          {row.role === "user" && (
            <span className="rounded-full border border-[#DDD6C5] px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[#7A7066]">
              Usuario
            </span>
          )}
          {row.suspendedAt && (
            <span className="rounded-full bg-[#E26A4A]/15 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[#C65D38]">
              Suspendido
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-[#7A7066]">{row.email}</div>
      </div>
      <div className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-[#A39A8E]">
        {relativeTime(row.createdAt)}
      </div>
    </button>
  )
}

function UserSidePanel({
  userId,
  onClose,
}: {
  userId: string
  onClose: () => void
}) {
  const detail = useAdminUserDetail(userId)
  const suspend = useAdminSuspendUser()
  const unsuspend = useAdminUnsuspendUser()
  const resetToken = useAdminResetPasswordToken()
  const [resetResult, setResetResult] = useState<
    AdminResetTokenResponse | null
  >(null)
  const [error, setError] = useState<string | null>(null)

  const u = detail.data

  async function handleSuspend() {
    if (!u) return
    setError(null)
    const ok = window.confirm(
      `¿Suspender la cuenta de ${u.username}? El usuario no podrá iniciar sesión hasta que la reactives.`,
    )
    if (!ok) return
    try {
      await suspend.mutateAsync(u.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo suspender.")
    }
  }

  async function handleUnsuspend() {
    if (!u) return
    setError(null)
    try {
      await unsuspend.mutateAsync(u.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reactivar.")
    }
  }

  async function handleResetToken() {
    if (!u) return
    setError(null)
    try {
      const r = await resetToken.mutateAsync(u.id)
      setResetResult(r)
      try {
        await navigator.clipboard.writeText(r.link)
      } catch {
        // Clipboard may be denied; the modal still shows the link.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo generar.")
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col overflow-y-auto bg-[#FAF6EE] shadow-xl sm:w-[28rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-[#DDD6C5] bg-[#FAF6EE] px-5 py-4">
          <div className="text-eyebrow text-[#7A7066]">Detalle de usuario</div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#4A4239] hover:bg-[#DDD6C5]/40"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 px-5 py-5">
          {detail.isLoading && (
            <p className="text-[12px] italic text-[#7A7066]">Cargando…</p>
          )}
          {detail.isError && (
            <p className="text-[12px] text-[#C65D38]">
              No se pudo cargar el usuario.
            </p>
          )}
          {u && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#C65D38] font-display text-lg text-[#FAF6EE]">
                  {(u.username || "?").charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-display text-xl text-[#1A1612] truncate">
                    {u.username}
                  </div>
                  <div className="text-[11px] text-[#7A7066] truncate">
                    {u.email}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] ${
                    u.role === "admin"
                      ? "bg-[#C65D38] text-[#FAF6EE]"
                      : "border border-[#DDD6C5] text-[#7A7066]"
                  }`}
                >
                  {u.role === "admin" ? "Admin" : "Usuario"}
                </span>
                {u.suspendedAt && (
                  <span className="rounded-full bg-[#E26A4A]/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[#C65D38]">
                    Suspendido
                  </span>
                )}
                {u.onboardingDone && (
                  <span className="rounded-full border border-[#2D6A4F]/30 bg-[#2D6A4F]/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[#2D6A4F]">
                    Onboarding ok
                  </span>
                )}
              </div>

              <Section title="Cuenta">
                <Stat label="Creado" value={formatSpanishDateTime(u.createdAt)} />
                <Stat label="Último login" value={formatSpanishDateTime(u.lastLoginAt)} />
                {u.suspendedAt && (
                  <Stat label="Suspendido el" value={formatSpanishDateTime(u.suspendedAt)} />
                )}
              </Section>

              <Section title="Actividad">
                <div className="grid grid-cols-2 gap-2">
                  <Tile label="Recetas creadas" value={u.recetasCreadas} />
                  <Tile label="Menús generados" value={u.menusGenerados} />
                </div>
              </Section>

              <Section title="Datos físicos">
                <Stat label="Sexo" value={u.sex ?? "—"} />
                <Stat label="Edad" value={u.age != null ? `${u.age}` : "—"} />
                <Stat
                  label="Peso"
                  value={u.weight != null ? `${u.weight} kg` : "—"}
                />
                <Stat
                  label="Altura"
                  value={u.height != null ? `${u.height} cm` : "—"}
                />
                <Stat label="Actividad" value={u.activityLevel ?? "—"} />
              </Section>

              <Section title="Hogar">
                <Stat
                  label="Adultos"
                  value={u.adults != null ? `${u.adults}` : "—"}
                />
                <Stat
                  label="Niños 2–10"
                  value={u.kidsCount != null ? `${u.kidsCount}` : "—"}
                />
              </Section>

              <Section title="Preferencias">
                <Stat label="Prioridad" value={u.priority ?? "—"} />
                <Stat
                  label="Frecuencia de cocina"
                  value={u.cookingFreq ?? "—"}
                />
                <Stat
                  label="Restricciones"
                  value={
                    Array.isArray(u.restrictions) && u.restrictions.length > 0
                      ? u.restrictions.join(", ")
                      : "—"
                  }
                />
                <Stat
                  label="Platos favoritos"
                  value={
                    Array.isArray(u.favoriteDishes) &&
                    u.favoriteDishes.length > 0
                      ? u.favoriteDishes.join(", ")
                      : "—"
                  }
                />
              </Section>

              {error && (
                <p className="mt-4 text-[12px] text-[#C65D38]">{error}</p>
              )}
            </>
          )}
        </div>

        {/* Action footer */}
        {u && (
          <footer className="sticky bottom-0 border-t border-[#DDD6C5] bg-[#FAF6EE] px-5 py-4">
            <div className="flex flex-col gap-2">
              {u.suspendedAt ? (
                <button
                  onClick={handleUnsuspend}
                  disabled={unsuspend.isPending}
                  className="rounded-full bg-[#2D6A4F] py-2.5 text-[12px] font-medium uppercase tracking-[0.1em] text-[#FAF6EE] hover:bg-[#235140] disabled:opacity-50"
                >
                  {unsuspend.isPending ? "Reactivando…" : "Reactivar"}
                </button>
              ) : (
                <button
                  onClick={handleSuspend}
                  disabled={suspend.isPending}
                  className="rounded-full bg-[#C65D38] py-2.5 text-[12px] font-medium uppercase tracking-[0.1em] text-[#FAF6EE] hover:bg-[#A84A2A] disabled:opacity-50"
                >
                  {suspend.isPending ? "Suspendiendo…" : "Suspender"}
                </button>
              )}
              <button
                onClick={handleResetToken}
                disabled={resetToken.isPending}
                className="rounded-full border border-[#1A1612] py-2.5 text-[12px] font-medium uppercase tracking-[0.1em] text-[#1A1612] hover:bg-[#1A1612] hover:text-[#FAF6EE] disabled:opacity-50"
              >
                {resetToken.isPending
                  ? "Generando…"
                  : "Generar enlace de reset"}
              </button>
            </div>
          </footer>
        )}
      </aside>

      {resetResult && (
        <ResetLinkModal
          result={resetResult}
          onClose={() => setResetResult(null)}
        />
      )}
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-6">
      <div className="text-eyebrow mb-2 text-[#7A7066]">{title}</div>
      <div className="rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] p-3">
        {children}
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-[12px]">
      <span className="text-[#7A7066]">{label}</span>
      <span className="text-right text-[#1A1612] font-medium">{value}</span>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[#FAF6EE] p-3 text-center">
      <div className="font-display text-2xl text-[#1A1612]">{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-[#7A7066]">
        {label}
      </div>
    </div>
  )
}

function ResetLinkModal({
  result,
  onClose,
}: {
  result: AdminResetTokenResponse
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  async function copyAgain() {
    try {
      await navigator.clipboard.writeText(result.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-5"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[#FAF6EE] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-eyebrow mb-2 text-[#7A7066]">
          Enlace de reset generado
        </div>
        <h3 className="font-display text-xl text-[#1A1612]">
          Comparte el <span className="font-italic italic text-[#C65D38]">enlace</span>
        </h3>
        <p className="mt-2 text-[12px] text-[#7A7066]">
          El enlace ya está copiado al portapapeles. Caduca el{" "}
          {formatSpanishDateTime(result.expires_at)}.
        </p>
        <div className="mt-3 break-all rounded-lg bg-[#FFFEFA] border border-[#DDD6C5] p-3 font-mono text-[11px] text-[#1A1612]">
          {result.link}
        </div>
        <div className="mt-4 flex gap-2">
          <button
            onClick={copyAgain}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#1A1612] py-2 text-[11px] uppercase tracking-[0.1em] text-[#1A1612] hover:bg-[#1A1612] hover:text-[#FAF6EE]"
          >
            <Copy size={12} />
            {copied ? "Copiado" : "Copiar de nuevo"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-full bg-[#1A1612] py-2 text-[11px] uppercase tracking-[0.1em] text-[#FAF6EE] hover:bg-[#C65D38]"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
