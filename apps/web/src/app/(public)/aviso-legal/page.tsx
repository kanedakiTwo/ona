import Link from "next/link"
import { BRAND_NAME, LEGAL_OWNER } from "@ona/shared"
import { CONTACT_EMAIL } from "@/lib/contact"

/**
 * Aviso legal (LSSI art. 10, PRO-22): who runs the service. Linked from the
 * public footer. The holder lives in `LEGAL_OWNER` (@ona/shared), shared with
 * /privacidad.
 */
const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-10 font-display text-2xl text-[#1A1612]">{children}</h2>
)

export default function AvisoLegalPage() {
  return (
    <div className="mx-auto max-w-[720px] px-4 pb-16 pt-28 md:pb-24 md:pt-32">
      <h1 className="font-display text-4xl text-[#1A1612] md:text-5xl">Aviso legal</h1>

      <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-[#4A4239]">
        <H2>Quién está detrás</H2>
        <ul className="ml-5 list-disc space-y-2" data-testid="legal-owner">
          <li>
            <strong>Titular:</strong> {LEGAL_OWNER.name}
          </li>
          <li>
            <strong>NIF:</strong> {LEGAL_OWNER.nif}
          </li>
          <li>
            <strong>Domicilio:</strong> {LEGAL_OWNER.address}
          </li>
          <li>
            <strong>Email de contacto:</strong>{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-4">
              {CONTACT_EMAIL}
            </a>
          </li>
        </ul>

        <H2>Qué es {BRAND_NAME}</H2>
        <p>
          {BRAND_NAME} es un planificador de menús semanales para hogares: propone el menú de la semana, prepara la
          lista de la compra y te ayuda a cocinar. No es un producto sanitario ni sustituye el consejo de un
          profesional.
        </p>

        <H2>Condiciones y privacidad</H2>
        <p>
          El uso de {BRAND_NAME} se rige por los{" "}
          <Link href="/terminos" className="underline underline-offset-4">
            términos y condiciones
          </Link>
          . Cómo tratamos tus datos está en la{" "}
          <Link href="/privacidad" className="underline underline-offset-4">
            política de privacidad
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
