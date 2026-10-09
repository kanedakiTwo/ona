'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The advisor is no longer a page (D-023): Mimo is the floating companion on
 * every screen. Old links and bookmarks land on the menu with Mimo open.
 */
export default function AdvisorRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/menu?mimo=1')
  }, [router])
  return null
}
