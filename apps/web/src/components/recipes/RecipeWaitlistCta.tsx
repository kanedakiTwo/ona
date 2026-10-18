import { ArrowUpRight } from "lucide-react"
import { BRAND_NAME } from "@ona/shared"
import { SignupCtaLink, WaitlistOnly } from "@/components/shared/SignupCta"

/** Where every public recipe CTA leads (specs/waitlist.md): the landing's waitlist, tagged as coming from a recipe. */
export const RECIPE_WAITLIST_HREF = "/?ref=receta#lista-de-espera"

/**
 * «¿Te gusta?» block at the end of the recipe page for signed-out visitors
 * (specs/recipes.md → "Página de receta"): pre-launch, the way in is the
 * waitlist. Public marketing surface — keep health claims out.
 */
export function RecipeWaitlistCta({ recipeName, className = "" }: { recipeName: string; className?: string }) {
  return (
    <section
      data-testid="recipe-waitlist-cta"
      aria-label="Lista de espera"
      className={`rounded-[28px] bg-[#1A1612] px-6 py-12 text-center text-[#FAF6EE] md:rounded-[32px] md:px-12 md:py-14 ${className}`}
    >
      <div className="text-eyebrow mb-5 text-[#FAF6EE]/60">¿Te gusta?</div>
      <h2 className="font-display text-[26px] leading-tight md:text-[32px]">
        Guarda <span className="font-italic italic">{recipeName}</span> y plantéate la semana con ella.
      </h2>
      <p className="mx-auto mt-5 max-w-md text-sm text-[#FAF6EE]/70 md:text-base">
        Cuando entres, podrás marcarla como favorita, ponerla en tu menú semanal y que {BRAND_NAME} te haga la lista de la compra.
      </p>
      <SignupCtaLink
        waitlistHref={RECIPE_WAITLIST_HREF}
        waitlistLabel="Únete a la lista de espera"
        openRef="receta"
        testId="recipe-signup-cta-link"
        className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-[#FAF6EE] px-7 py-4 text-base font-medium text-[#1A1612] transition-all hover:gap-3.5 hover:bg-[#C65D38] hover:text-[#FAF6EE]"
        icon={<ArrowUpRight size={18} />}
      />
    </section>
  )
}

/** The catalogue's CTA (`/recipes` signed out), tagged apart from the recipe page's. */
export const CATALOGUE_WAITLIST_HREF = "/?ref=recetas#lista-de-espera"

/** Closing block of the public catalogue (`/recipes` signed out): the way in is the waitlist. */
export function CatalogueWaitlistCta({ className = "" }: { className?: string }) {
  return (
    <section
      data-testid="recipes-waitlist-cta"
      aria-label="Lista de espera"
      className={`rounded-[28px] bg-[#1A1612] px-6 py-12 text-center text-[#FAF6EE] md:rounded-[32px] md:px-12 md:py-16 ${className}`}
    >
      <div className="text-eyebrow mb-5 text-[#FAF6EE]/60">Para hacerlas tuyas</div>
      <h2 className="font-display text-[26px] leading-tight md:text-[36px]">
        Apúntate y <span className="font-italic italic">{BRAND_NAME} te plantea la semana</span> con ellas.
      </h2>
      <p className="mx-auto mt-5 max-w-md text-sm text-[#FAF6EE]/70 md:text-base">
        Cuando entres, te propone el menú de cada semana, te hace la lista de la compra y guarda tus favoritas. <WaitlistOnly>Entramos por tandas, sin tarjeta.</WaitlistOnly>
      </p>
      <SignupCtaLink
        waitlistHref={CATALOGUE_WAITLIST_HREF}
        waitlistLabel="Únete a la lista de espera"
        openRef="recetas"
        testId="recipes-signup-cta-link"
        className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-[#FAF6EE] px-7 py-4 text-base font-medium text-[#1A1612] transition-all hover:gap-3.5 hover:bg-[#C65D38] hover:text-[#FAF6EE]"
        icon={<ArrowUpRight size={18} />}
      />
    </section>
  )
}
