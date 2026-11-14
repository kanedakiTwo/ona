import { redirect } from "next/navigation"

/** «Recetarios» lives in the Recetas tab since PRO-1202 (specs/cookbooks.md). */
export default function CookbooksRedirect() {
  redirect("/recipes/recetarios")
}
