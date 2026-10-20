"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { useSchoolMenu } from "@/hooks/useSchoolMenu"
import { SUB_CARD } from "@/components/profile/SubPage"

/**
 * PRO-224: a discreet row in /profile/casa → «Menú del cole», only when the
 * household has a child (a «Niñ@» member or children counted at sign-up).
 */
export function SchoolMenuLink() {
  const { data } = useSchoolMenu()
  if (!data?.visible) return null
  return (
    <Link
      href="/profile/casa/cole"
      data-testid="school-menu-link"
      className={`${SUB_CARD} mt-8 flex min-h-[56px] items-center justify-between gap-3 px-4 py-3 text-ink transition-colors hover:bg-bone`}
    >
      <span>
        <span className="block text-[15px] font-medium">Menú del cole</span>
        <span className="block text-[13px] text-ink-muted">Pásame el menú del comedor y la cena no repetirá lo de mediodía.</span>
      </span>
      <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-ink-muted" />
    </Link>
  )
}
