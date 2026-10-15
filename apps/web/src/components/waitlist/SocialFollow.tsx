import { Facebook, Instagram } from "lucide-react"
import { BRAND_SOCIAL_LINKS } from "@ona/shared"

const ICONS = { Instagram, Facebook } as const

/**
 * After joining the waitlist (2026-10-15, replaces the price questions):
 * ask people to follow Mimoia so the message reaches more homes.
 */
export function SocialFollow() {
  return (
    <div className="mt-10 border-t border-dashed border-[#DDD6C5] pt-8" data-testid="waitlist-social">
      <h4 className="font-display text-2xl text-[#1A1612]">
        Ayúdanos a llegar <span className="font-italic italic text-[#C65D38]">a más casas</span>
      </h4>
      <p className="mt-3 text-sm leading-relaxed text-[#4A4239]">
        Síguenos: recetas de temporada, menús de la semana y cómo va Mimoia. Cada vez que compartes algo
        nuestro, llega a alguien que también improvisa la cena.
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        {BRAND_SOCIAL_LINKS.map((s) => {
          const Icon = ICONS[s.network]
          return (
            <a
              key={s.network}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-full border border-[#1A1612] px-6 text-[14px] font-medium text-[#1A1612] transition-colors hover:bg-[#F1EBDD]"
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              {s.network} <span className="text-[#7A7066]">{s.handle}</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}
