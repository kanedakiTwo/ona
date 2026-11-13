import { redirect } from "next/navigation"

/** The pantry lives in the «Cocinar» tab since 2026-11 (specs/cook-now.md). */
export default function PantryRedirect() {
  redirect("/cocinar#despensa")
}
