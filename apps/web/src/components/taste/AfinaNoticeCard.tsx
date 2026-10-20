"use client"

/**
 * PRO-205 (specs/taste.md → «Aviso a los hogares afectados»): the one-off
 * notice to the households «Afina tu menú» may have shown a dish that broke
 * their allergies or diet. The API decides who sees it and when
 * (`GET /notices/afina`); «Entendido» closes it for the whole household.
 * The text is Legal's and comes from the API.
 */
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

type Notice = { show: false } | { show: true; text: string }

export function AfinaNoticeCard() {
  const qc = useQueryClient()
  const notice = useQuery<Notice>({
    queryKey: ["notices", "afina"],
    queryFn: () => api.get<Notice>("/notices/afina"),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const dismiss = useMutation({
    mutationFn: () => api.post("/notices/afina/dismiss", {}),
    onSuccess: () => qc.setQueryData<Notice>(["notices", "afina"], { show: false }),
  })
  const data = notice.data
  if (!data?.show || dismiss.isPending || dismiss.isSuccess) return null
  return (
    <section
      data-testid="afina-notice"
      aria-labelledby="afina-notice-title"
      className="mx-5 mt-3 flex flex-col gap-3 rounded-[18px] border border-border-soft bg-paper p-[18px] lg:mx-0"
    >
      <p className="m-0 text-[11.2px] font-medium uppercase tracking-[0.18em] text-terracotta-deep">Aviso</p>
      <h2 id="afina-notice-title" className="m-0 font-display text-[20px] font-[650] leading-[1.15] text-ink">
        Un fallo en «Afina tu menú», ya arreglado
      </h2>
      <p className="m-0 text-[14px] leading-[1.5] text-ink-mid">{data.text}</p>
      <div className="flex items-center gap-2">
        <Link
          href="/profile"
          className="flex min-h-[48px] flex-1 items-center justify-center rounded-full bg-ink text-[15px] font-medium text-cream"
        >
          Ir a mi perfil
        </Link>
        <button
          type="button"
          onClick={() => dismiss.mutate()}
          className="min-h-[48px] rounded-full border border-border px-[18px] text-[15px] text-ink"
        >
          Entendido
        </button>
      </div>
    </section>
  )
}
