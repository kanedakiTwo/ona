import { CONTACT_PHONE, CONTACT_PHONE_NOTE } from "@/lib/contact"

/**
 * Support phone line (D-071, PRO-249) for `/aviso-legal` and `/terminos`.
 * Renders nothing without `NEXT_PUBLIC_SUPPORT_PHONE`: never a made-up number.
 */
export function SupportPhone({ as: Tag = "p" }: { as?: "p" | "li" }) {
  if (!CONTACT_PHONE) return null
  return (
    <Tag data-testid="support-phone">
      <strong>Teléfono:</strong>{" "}
      <a href={`tel:${CONTACT_PHONE.replace(/[^\d+]/g, "")}`} className="underline underline-offset-4">
        {CONTACT_PHONE}
      </a>{" "}
      ({CONTACT_PHONE_NOTE})
    </Tag>
  )
}
