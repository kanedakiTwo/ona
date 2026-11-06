/**
 * 4 weeks free with a creator's link (PRO-353, D-130; specs/billing.md).
 *
 * The household created by someone who came with any creator's ref (`cr-<alias>`) has
 * `CREATOR_TRIAL_DAYS` instead of `TRIAL_DAYS`. Where the ref may be:
 *   - their account (`users.signup_attribution.source`, PRO-162), or
 *   - their waitlist row (`waitlist_entries.source`, same email): whoever
 *     joined the list with the link and came in later from the invitation,
 *     in another browser or after 30 days, has no `ref` on the account.
 *
 * Read on the fly, nothing stored: beta households that already came with a
 * creator's link get it too, without touching saved data. «Created by» is
 * the owner whose own membership started with the household: someone who
 * joins an existing household (or inherits it when the owner deletes their
 * account) never changes that household's trial.
 *
 * The SQL only narrows to `cr-%`; the rule is `trialDaysFor` in `@ona/shared`.
 */
import { sql, type SQL } from 'drizzle-orm'

/** How long after the household the creator's own membership may start (same request in /register). */
const CREATOR_MEMBERSHIP_SLACK = '10 minutes'

/**
 * `text[]` with the `cr-…` refs the household's creator came with (empty when
 * none). `household` is the SQL alias or table name of `households` in the
 * outer query (a constant in our code, never user input).
 */
export function creatorRefsSql(household: 'h' | 'households'): SQL<string[] | null> {
  const h = sql.raw(`"${household}"`)
  return sql<string[] | null>`(
    SELECT array_remove(ARRAY[
      CASE WHEN cu.signup_attribution->>'source' LIKE 'cr-%' THEN cu.signup_attribution->>'source' END
    ] || COALESCE((
      SELECT array_agg(w.source) FROM waitlist_entries w
      WHERE w.email = lower(cu.email) AND w.source LIKE 'cr-%'
    ), ARRAY[]::text[]), NULL)
    FROM users cu
    JOIN household_members cm ON cm.user_id = cu.id AND cm.household_id = ${h}.id AND cm.role = 'owner'
    WHERE cu.id = ${h}.owner_id
      AND cm.joined_at <= ${h}.created_at + interval '${sql.raw(CREATOR_MEMBERSHIP_SLACK)}'
  )`
}
