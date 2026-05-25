# Recipe Photos

**Status:** PR 8C shipped.

Household-shared photo gallery per recipe. Distinct from `recipes.image_url` (the canonical hero shot — author-side). This is the **consumer's** wall of "look how it came out": cook results, plating variations, family snaps. Any member of the household can upload; any member can delete.

## User Capabilities

- On a recipe detail page, an authed user sees a "Galería" section below the household notes.
- Tap "Añadir foto" → opens the system file picker (camera + library on mobile). Accepted: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`. Max 8 MB.
- Preview the picked file, add an optional caption (≤ 280 chars), tap "Subir foto" to upload.
- Tap any thumbnail to open the full-resolution lightbox.
- Tap the trash icon on any thumbnail to delete (any household member can delete any photo).

## Data Model

`recipe_photos`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | also the storage filename: `<id>.jpg` |
| `recipe_id` | uuid → recipes | ON DELETE CASCADE |
| `household_id` | uuid → households | scope key, NOT NULL |
| `uploaded_by_user_id` | uuid? → users | audit trail; ON DELETE SET NULL |
| `image_url` | text | `${IMAGE_PUBLIC_URL_BASE}/<id>.jpg` |
| `caption` | text? | ≤ 280 chars (route-enforced) |
| `created_at` | timestamptz | bookkeeping |

Indexes: `idx_recipe_photos_recipe` on `(recipe_id)`, `idx_recipe_photos_household` on `(household_id)`.

## Storage

Reuses the existing Railway volume:
- Files written to `${IMAGE_STORAGE_DIR}/<photo-id>.jpg`.
- Public URL constructed as `${IMAGE_PUBLIC_URL_BASE}/<photo-id>.jpg`.
- Sharp pipeline on upload: `rotate()` (honour EXIF orientation from phone cameras) → `resize(width: 1600, withoutEnlargement: true)` → `jpeg(quality: 85, mozjpeg: true)`. One JPEG per row.
- Delete is best-effort on disk — DB row is removed regardless; if the file is already gone, we log and continue.

## REST Surface

| Method | Path | Notes |
|---|---|---|
| GET | `/recipes/:recipeId/photos` | List household gallery for the recipe, newest first; returns `[]` if none. Each row includes `uploadedByUsername` for the audit label |
| POST | `/recipes/:recipeId/photos` | `multipart/form-data` with `photo` (required, ≤ 8 MB) and optional `caption`. Returns the persisted row |
| DELETE | `/recipes/:recipeId/photos/:photoId` | Hard delete. 204 on success. 404 if the photo isn't in the caller's household |

All routes are auth-only + household-scoped (any household member can read or write).

## Constraints

- Photo bytes are streamed via `multer.memoryStorage()` (max 8 MB). The sharp pipeline rewrites the file before the DB insert so unsupported formats (or malformed images) throw at sharp-time and we never persist a row pointing at non-existent bytes.
- The component on `/recipes/[id]` is gated by `user` — anonymous visitors on `/recipes-ona/[id]` never see the gallery (it would need auth to load anyway).
- HEIC files from iOS Safari upload cleanly thanks to sharp's libheif support — same pipeline produces the JPEG.
- No favicon-style placeholder when the gallery is empty; the section simply shows the "Añadir foto" CTA on its own.

## Related specs

- [Recipes](./recipes.md) — `recipes.image_url` (the author's hero) is unchanged; this layers a household gallery on top.
- [Household](./household.md) — scope policy.
- [Recipe Notes](./recipe-notes.md) — sibling household-shared annotations (rating / notes / substitutions / custom tags).

## Source

- `apps/api/src/db/schema.ts` — `recipePhotos`
- `apps/api/src/db/migrations/0019_pr8c_recipe_photos.sql`
- `apps/api/src/services/recipePhotosStore.ts` — sharp pipeline + CRUD
- `apps/api/src/routes/recipePhotos.ts` — REST surface, `multer` config
- `apps/web/src/hooks/useRecipePhotos.ts`
- `apps/web/src/components/recipes/RecipePhotoGallery.tsx`
- `apps/web/src/app/recipes/[id]/page.tsx` — section mounted below the notes card
