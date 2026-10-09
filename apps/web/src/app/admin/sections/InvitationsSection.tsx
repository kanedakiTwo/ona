"use client"

/**
 * InvitationsSection — invitation links by campaign (PRO-27).
 *
 * Create a link (campaign name, optional max uses and expiry) and see, per
 * campaign, its link, uses and — from GET /admin/metrics → `campaigns` —
 * signups, activation and week 3, so Miguel's circle is read apart from
 * strangers. Spec: specs/auth.md → Closed beta, specs/admin-dashboard.md.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

interface Campaign {
  id: string
  name: string
  code: string
  url: string
  maxUses: number | null
  uses: number
  expiresAt: string | null
  createdAt: string
}

interface CampaignMetrics {
  campaign: string | null
  signups: number
  activated: number
  activationRate: number | null
  week3Eligible: number
  week3Active: number
  week3Rate: number | null
}

const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)} %`)

export function InvitationsSection() {
  const qc = useQueryClient()
  const campaigns = useQuery({
    queryKey: ["admin", "invite-campaigns"],
    queryFn: () => api.get<Campaign[]>("/admin/invite-campaigns"),
  })
  const metrics = useQuery({
    queryKey: ["admin", "metrics", "campaigns"],
    queryFn: () => api.get<{ campaigns: CampaignMetrics[] }>("/admin/metrics?weeks=12"),
  })
  const [name, setName] = useState("")
  const [maxUses, setMaxUses] = useState("")
  const [expires, setExpires] = useState("")
  const create = useMutation({
    mutationFn: () =>
      api.post<Campaign>("/admin/invite-campaigns", {
        name: name.trim(),
        maxUses: maxUses ? Number(maxUses) : null,
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      }),
    onSuccess: () => {
      setName("")
      setMaxUses("")
      setExpires("")
      qc.invalidateQueries({ queryKey: ["admin", "invite-campaigns"] })
    },
  })
  const byName = new Map((metrics.data?.campaigns ?? []).map((m) => [m.campaign, m]))

  return (
    <section data-testid="invitations-section" className="space-y-8">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
        className="grid gap-3 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-4 md:grid-cols-4 md:items-end"
      >
        <label className="flex flex-col gap-1 text-[12px] text-[#7A7066]">
          Campaña
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="familia, amigos-padel…"
            className="rounded-lg border border-[#DDD6C5] px-3 py-2 text-[14px] text-[#1A1612]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[#7A7066]">
          Usos máximos (opcional)
          <input
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            className="rounded-lg border border-[#DDD6C5] px-3 py-2 text-[14px] text-[#1A1612]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[#7A7066]">
          Caduca el (opcional)
          <input
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className="rounded-lg border border-[#DDD6C5] px-3 py-2 text-[14px] text-[#1A1612]"
          />
        </label>
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-full bg-[#1A1612] px-5 py-2.5 text-[13px] font-semibold text-[#FAF6EE] disabled:opacity-40"
        >
          Crear enlace
        </button>
        {create.isError && <p className="text-[12px] text-[#B5451B] md:col-span-4">No se ha podido crear el enlace.</p>}
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-[0.1em] text-[#7A7066]">
            <tr>
              <th className="py-2 pr-3">Campaña</th>
              <th className="py-2 pr-3">Enlace</th>
              <th className="py-2 pr-3">Usos</th>
              <th className="py-2 pr-3">Caduca</th>
              <th className="py-2 pr-3">Altas (12 sem.)</th>
              <th className="py-2 pr-3">Activación</th>
              <th className="py-2 pr-3">Semana 3</th>
            </tr>
          </thead>
          <tbody>
            {(campaigns.data ?? []).map((c) => {
              const m = byName.get(c.name)
              return (
                <tr key={c.id} className="border-t border-[#E8E2D3]" data-testid={`campaign-${c.code}`}>
                  <td className="py-2 pr-3 font-semibold text-[#1A1612]">{c.name}</td>
                  <td className="py-2 pr-3 font-mono text-[12px]">{c.url}</td>
                  <td className="py-2 pr-3">
                    {c.uses}
                    {c.maxUses != null ? ` / ${c.maxUses}` : ""}
                  </td>
                  <td className="py-2 pr-3">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("es-ES") : "—"}</td>
                  <td className="py-2 pr-3" data-testid="campaign-signups">{m?.signups ?? 0}</td>
                  <td className="py-2 pr-3">{m ? `${m.activated} (${pct(m.activationRate)})` : "—"}</td>
                  <td className="py-2 pr-3">{m ? `${m.week3Active}/${m.week3Eligible} (${pct(m.week3Rate)})` : "—"}</td>
                </tr>
              )
            })}
            {byName.has(null) && (
              <tr className="border-t border-[#E8E2D3] text-[#7A7066]">
                <td className="py-2 pr-3">Sin campaña</td>
                <td className="py-2 pr-3" colSpan={3}>
                  lista de espera, hogar, admin o registro abierto
                </td>
                <td className="py-2 pr-3">{byName.get(null)!.signups}</td>
                <td className="py-2 pr-3">
                  {byName.get(null)!.activated} ({pct(byName.get(null)!.activationRate)})
                </td>
                <td className="py-2 pr-3">
                  {byName.get(null)!.week3Active}/{byName.get(null)!.week3Eligible} ({pct(byName.get(null)!.week3Rate)})
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {campaigns.data?.length === 0 && <p className="py-4 text-[13px] text-[#7A7066]">Aún no hay enlaces.</p>}
      </div>
    </section>
  )
}
