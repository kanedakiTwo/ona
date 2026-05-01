'use client'

import { useAuth } from '@/lib/auth'
import { useAdvisorSummary } from '@/hooks/useAdvisor'
import AdvisorChat from '@/components/advisor/AdvisorChat'

export default function AdvisorPage() {
  const { user, isLoading: authLoading } = useAuth()
  useAdvisorSummary(user?.id)

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE]">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="flex h-[calc(100dvh-100px)] flex-col bg-[#FAF6EE]">
      {/* Editorial header */}
      <header className="border-b border-[#DDD6C5] bg-[#FAF6EE] px-5 pt-6 pb-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-eyebrow mb-1">El asesor</div>
            <h1 className="font-display text-[1.8rem] leading-none text-[#1A1612]">
              Pregunta lo que <span className="font-italic italic text-[#C65D38]">quieras</span>.
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#7A7066] opacity-40 animate-pulse-soft" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7A7066]" />
            </span>
            <span className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">En linea</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <AdvisorChat userId={user.id} />
      </div>
    </div>
  )
}
