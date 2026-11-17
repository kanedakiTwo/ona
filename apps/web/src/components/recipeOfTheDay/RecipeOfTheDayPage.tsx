import Link from "next/link"
import { ArrowRight, Clock, ExternalLink } from "lucide-react"
import type { RecipeOfTheDayView } from "@ona/shared"
import { formatDayEs } from "@/lib/recipeOfTheDay"
import { minutesLabel } from "@/lib/recipeView"

/**
 * The public page of «la receta del día» (PRO-1099, specs/recipe-of-the-day.md):
 * `/receta-del-dia` (today's) and `/receta-del-dia/<fecha>`. Server component,
 * editorial style (specs/design-system.md). When the day asked for has none,
 * it says so and shows the last one, with its date.
 */
export default function RecipeOfTheDayPage({ view }: { view: RecipeOfTheDayView | null }) {
  return (
    <article className="bg-[#FAF6EE] pb-24 pt-28 md:pb-32 md:pt-36" data-testid="recipe-of-the-day">
      <div className="public-container">
        <div className="max-w-[720px]">
          <div className="text-eyebrow">La receta del día</div>
          {view ? <Featured view={view} /> : <Empty />}
        </div>
      </div>
    </article>
  )
}

function Empty() {
  return (
    <div className="mt-6" data-testid="recipe-of-the-day-empty">
      <h1 className="font-display text-[40px] leading-[1.05] tracking-[-0.02em] text-[#1A1612] md:text-[56px]">
        Todavía no hay receta del día
      </h1>
      <p className="mt-6 text-[17px] leading-relaxed text-[#4A4239]">Mientras llega, mira todas las recetas del catálogo.</p>
      <Link
        href="/recipes"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-6 py-3 text-[15px] font-medium text-[#FAF6EE]"
      >
        Ver las recetas <ArrowRight size={16} />
      </Link>
    </div>
  )
}

function Featured({ view }: { view: RecipeOfTheDayView }) {
  const minutes = minutesLabel(view.minutes)
  return (
    <>
      {!view.isRequestedDate && (
        <p className="mt-4 rounded-2xl bg-[#EFE8D8] px-4 py-3 text-[15px] text-[#4A4239]" data-testid="recipe-of-the-day-fallback">
          {formatDayEs(view.requestedDate)} no tiene receta del día: esta es la última, del {formatDayEs(view.date).toLowerCase()}.
        </p>
      )}
      <header className="mt-6">
        <time dateTime={view.date} className="text-[14px] text-[#7A7066]">
          {formatDayEs(view.date)}
        </time>
        <h1 className="mt-3 font-display text-[40px] leading-[1.05] tracking-[-0.02em] text-[#1A1612] md:text-[56px]">
          {view.title}
        </h1>
        {view.credit && <p className="mt-3 font-italic text-[18px] italic text-[#7A7066]">{view.credit}</p>}
      </header>

      {view.imageUrl && (
        <div className="mt-8 aspect-[4/5] overflow-hidden rounded-[24px] bg-[#EFE8D8] md:aspect-[16/10]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={view.imageUrl} alt={view.title} className="h-full w-full object-cover" />
        </div>
      )}

      <p className="mt-8 font-italic text-[22px] italic leading-snug text-[#4A4239]">{view.text}</p>

      <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-[15px] text-[#4A4239]">
        {minutes && (
          <div className="flex items-center gap-2">
            <Clock size={16} aria-hidden />
            <dt className="sr-only">Tiempo</dt>
            <dd>{minutes}</dd>
          </div>
        )}
        {view.cuisine && (
          <div className="flex items-center gap-2">
            <dt className="text-[#7A7066]">Cocina</dt>
            <dd className="capitalize">{view.cuisine}</dd>
          </div>
        )}
      </dl>

      {view.keyIngredients.length > 0 && (
        <section className="mt-8">
          <h2 className="text-eyebrow">Lo que lleva</h2>
          <ul className="mt-3 flex flex-wrap gap-2" data-testid="recipe-of-the-day-ingredients">
            {view.keyIngredients.map((name) => (
              <li key={name} className="rounded-full border border-[#E2D8C6] px-4 py-1.5 text-[15px] capitalize text-[#1A1612]">
                {name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <Link
          href={`/recipes/${view.recipeId}`}
          className="inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-6 py-3 text-[15px] font-medium text-[#FAF6EE]"
        >
          Ver la receta <ArrowRight size={16} />
        </Link>
        {view.sourceUrl && (
          <a
            href={view.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[15px] text-[#7A7066] underline-offset-4 hover:underline"
          >
            Ver fuente <ExternalLink size={14} />
          </a>
        )}
      </div>
    </>
  )
}
