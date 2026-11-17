/**
 * The invitation of «¿Quién hace la compra?» in Mimo's WhatsApp sign-up
 * (PRO-383, D-051, D-158; specs/whatsapp.md). When the household says that
 * someone else buys or that they take turns, `complete_onboarding` hands over
 * the same message and link as the web's «Mandar invitación»: a household
 * invitation prepared in the sign-up (`source: 'alta'`, counted in
 * `familyInvites.bySource.alta`), sent in that same reply (`shared`). It
 * takes the place of the sign-up's «Familia en el mismo hogar» offer, so the
 * `alta` moment is stamped too.
 */
import { shopperInviteText, householdInvitePath } from '@ona/shared'
import { env } from '../config/env.js'
import { createInvite } from './householdStore.js'
import { familyOfferEligible, loadFamilyOfferInput, stampFamilyOffer } from './familyInviteOffers.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'

/** The message with the link, or null when this account can't invite (not the owner, already two accounts). */
export async function shopperInviteForSignUp(userId: string): Promise<{ url: string; message: string } | null> {
  const input = await loadFamilyOfferInput(userId)
  if (!input || !familyOfferEligible(input)) return null
  const householdId = await getPrimaryHouseholdId(userId)
  if (!householdId) return null
  const invite = await createInvite(userId, householdId, 'member', null, { source: 'alta', shared: true })
  await stampFamilyOffer(userId, 'alta').catch(() => false)
  const url = `${env.WEB_PUBLIC_URL}${householdInvitePath(invite.token)}`
  return { url, message: shopperInviteText(url) }
}
