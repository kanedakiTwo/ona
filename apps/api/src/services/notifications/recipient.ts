/**
 * Avisos of the household go to ONE person (PRO-236, D-080): the shopping
 * reminder and the Sunday nudge are about the shared list and menu, so in a
 * house with several people connected only one gets them — whoever manages
 * the household (the owner), or, if the owner turned that aviso off (or
 * doesn't get avisos), the next person who gets it (by join date). So «la
 * que elijan» = the others switch it off by asking Mimo.
 * Pure (noticeHours.test.ts).
 */

/** Kinds that are about the whole household (shared list, shared menu). */
export const HOUSEHOLD_NOTICE_KINDS: ReadonlySet<string> = new Set(['shopping_reminder', 'weekly_nudge'])

export interface HouseholdMember {
  userId: string
  isOwner: boolean
  joinedAt: Date | null
}

/** Pure: who of the household gets a household aviso, or null when nobody does. */
export function householdNoticeRecipient(members: readonly HouseholdMember[], gets: (userId: string) => boolean): string | null {
  const ordered = [...members].sort((a, b) => {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1
    return (a.joinedAt?.getTime() ?? Infinity) - (b.joinedAt?.getTime() ?? Infinity)
  })
  return ordered.find((m) => gets(m.userId))?.userId ?? null
}
