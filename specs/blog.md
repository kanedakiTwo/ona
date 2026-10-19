# Blog (mimoia.com/blog)

Public articles on mimoia.com (PRO-92). Each article is a Markdown file in the repo; there is no CMS, no editor and no comments. Only articles marked `publicado: true` exist for visitors. Publishing an article is an external action (L3 in Mimoia HQ): Miguel approves it, then a session flips `publicado` to `true`, commits and the web is redeployed.

## User Capabilities

- Visitors open **`/blog`** from the "Blog" link in the public footer (landing and every public page). The page uses the editorial skin (cream `#FAF6EE`, Fraunces, `text-editorial-xl` headline «El *blog*.») and lists the published articles, newest first: photo (`aspect-[4/3]`, `rounded-[24px]`), eyebrow with date («14 de octubre de 2026») and author, Fraunces title and summary. One column on a phone, two at `md+`, on the public grid (title on the logo's x, see [Design System](./design-system.md) → Layout).
- With no published article, `/blog` shows «Pronto, los primeros artículos.» and a "Únete a la lista de espera" pill (`/?ref=blog#lista-de-espera`).
- **`/blog/<slug>`** shows one published article in a 720 px reading column, left-aligned on the public grid: "← Blog" back link, eyebrow (date · author), Fraunces `<h1>` title, Cormorant italic summary, hero photo (`aspect-[16/10]`), then the body. It ends with a **waitlist call** (`BlogWaitlistCta`, `data-testid="blog-cta"`): sand card, «Tu semana de comidas, *ya pensada*.», and the ink pill "Únete a la lista de espera" → `/?ref=blog#lista-de-espera`, so the waitlist records `ref=blog` (see [Waitlist](./waitlist.md)).
- An unknown slug or an article with `publicado: false` answers **404**.
- Mimo's floating button is hidden on the blog (public pages); the public navbar and the common footer frame every blog page.

## Writing an article

- File: `apps/web/content/blog/<slug>.md`. The slug is the file name: lowercase letters, digits and hyphens (`decidir-la-cena-cansa-mas-que-cocinarla`).
- Header (all fields required; values may be quoted):
  ```
  ---
  titulo: Decidir la cena cansa más que cocinarla
  fecha: 2026-10-14          # AAAA-MM-DD
  autor: Miguel Martín
  resumen: Una o dos frases: el listado, la meta description y Open Graph.
  imagen: /landing/step-02.jpg   # path under apps/web/public or an https URL
  publicado: false           # true | false
  ---
  ```
- Body Markdown subset: `##` / `###` headings (a `#` in the body becomes `<h2>`: the page `<h1>` is the title), paragraphs, `-` and `1.` lists, `>` quotes, `---` rules, `![alt](src)` images (`/…` or `https://…` only), and inline **bold**, *italic*, `code` and `[links](url)` (site paths, `#`, `https://`, `http://`, `mailto:`; external links open in a new tab with `rel="noopener noreferrer"`). Anything else, raw HTML included, is shown as text — the page renders parsed tokens as React elements, never HTML.
- A bad header (missing field, date not `AAAA-MM-DD`, `publicado` not `true`/`false`, image not `/` or `https://`) or a bad file name **throws**: the build and the unit test fail instead of the article silently vanishing.
- Copy follows the claims guide: no health claims (guarded by `publicHealthClaims.test.ts`, which scans every article, published or not, and `components/blog/`), brand Mimoia (`brandName.test.ts`). Never copy text from `kb/`.
- The repo ships one **example article, unpublished**: `decidir-la-cena-cansa-mas-que-cocinarla.md`.
- **Published:** `la-cocina-sera-nuestro-refugio.md` (2026-10-19, by Miguel; cover and inline photo in `apps/web/public/blog/`; the waitlist link carries `?ref=articulo-refugio`). Its line «Vamos dejando entrar a los hogares por tandas» must change on 2026-11-16, when sign-up opens (MKT-30).

## SEO

- Each page sets its own metadata (Next `metadata` / `generateMetadata`, `metadataBase` = `SITE_URL` `https://mimoia.com`): `<title>` («Blog · Mimoia», «<titulo> · Mimoia»), description (`resumen`), canonical (`https://mimoia.com/blog[/slug]`), Open Graph (`og:type` website/article, title, description, image, `article:published_time`, author). The root layout skips its default `<title>`/description on `/blog*` (`hasOwnMetadata`) so they are not duplicated.
- **`/sitemap.xml`** (`app/sitemap.ts`, new with the blog) lists the public pages (`/`, `/como-funciona`, `/blog`, `/privacidad`, `/terminos`, `/aviso-legal`) and every published article with `lastmod` = `fecha`.

## Constraints

- Static: `/blog` and the published articles are pre-rendered at build time (`generateStaticParams`, `dynamicParams = false`). Publishing or unpublishing needs a commit + redeploy of `ona-web`. The Markdown files are also traced into the standalone build (`outputFileTracingIncludes` in `next.config.ts`).
- Test hook: outside production (`NODE_ENV !== 'production'`), `BLOG_CONTENT_DIR` points the loader at another folder. The e2e job boots `next dev` with `BLOG_CONTENT_DIR=e2e/fixtures/blog` (one published and one unpublished fixture), so the suite reads a published article without publishing anything real. A production build ignores it.
- Staging shows the same articles as production (same files, same rule): with only the example article in the repo, `/blog` on staging shows the empty state.

## Known limitations

- No categories, tags, pagination, RSS, search, comments or author pages.
- No `robots.txt` yet (the sitemap has to be submitted to Search Console by hand or linked from a future `robots.ts`).
- No scheduled publishing: `fecha` is only the date shown; an article is live as soon as `publicado: true` is deployed.
- Images are plain `<img>` (no optimizer, see `next.config.ts`); keep them reasonably sized.

## Related specs

- [Waitlist](./waitlist.md) — `?ref=blog` attribution of the CTA.
- [Design System](./design-system.md) — editorial skin, public footer.

## Source

- [apps/web/src/app/(public)/blog/page.tsx](../apps/web/src/app/(public)/blog/page.tsx) — listing
- [apps/web/src/app/(public)/blog/[slug]/page.tsx](../apps/web/src/app/(public)/blog/[slug]/page.tsx) — article + metadata
- [apps/web/src/app/sitemap.ts](../apps/web/src/app/sitemap.ts)
- [apps/web/src/lib/blog/markdown.ts](../apps/web/src/lib/blog/markdown.ts) — header + Markdown parser (pure)
- [apps/web/src/lib/blog/posts.ts](../apps/web/src/lib/blog/posts.ts) — fs loader, `BLOG_CONTENT_DIR`
- [apps/web/src/lib/site.ts](../apps/web/src/lib/site.ts) — `SITE_URL`
- [apps/web/src/components/blog/](../apps/web/src/components/blog/) — `BlogBody`, `BlogWaitlistCta`
- [apps/web/content/blog/](../apps/web/content/blog/) — the articles
- [apps/web/src/components/shared/Footer.tsx](../apps/web/src/components/shared/Footer.tsx) — "Blog" link
- [apps/web/src/app/layout.tsx](../apps/web/src/app/layout.tsx) — public route + `hasOwnMetadata`
- Tests: [apps/api/src/tests/blogMarkdown.test.ts](../apps/api/src/tests/blogMarkdown.test.ts), [apps/web/e2e/blog.spec.ts](../apps/web/e2e/blog.spec.ts) (+ `e2e/fixtures/blog/`)
