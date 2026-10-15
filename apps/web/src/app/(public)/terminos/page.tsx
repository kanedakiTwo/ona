import Link from "next/link"
import { CONTACT_EMAIL } from "@/lib/contact"

/**
 * Intended purpose (D-038, Mimoia HQ constitution §6), word for word. Do not
 * reword it: it is what keeps Mimoia outside the medical-device rules.
 * Pinned by apps/api/src/tests/termsIntendedPurpose.test.ts and the e2e
 * legal-notice.spec.ts (PRO-70).
 */
const INTENDED_PURPOSE =
  "Mimoia es un planificador de menús, recetas y lista de la compra para hogares, según sus gustos, preferencias y restricciones declaradas. Ofrece información general de alimentación. No está destinado a diagnosticar, prevenir, predecir, tratar ni controlar ninguna enfermedad, ni sustituye a un profesional sanitario."

export default function TerminosPage() {
  return (
    <div className="public-container pb-16 pt-28 md:pb-24 md:pt-32">
      <div className="max-w-[720px]" data-testid="reading-column">
        <h1 className="mb-8 font-display text-4xl text-[#1A1612] md:text-5xl">Términos y condiciones</h1>

        <div className="prose-ona space-y-6 text-[#444444] leading-relaxed">
          <p className="text-sm text-[#777777]">Última actualización: octubre 2026</p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">1. Aceptación de los términos</h2>
          <p>
            Al acceder y usar Mimoia, aceptas estos términos y condiciones en su totalidad. Si no
            estás de acuerdo con alguna parte, no deberías usar el servicio.
          </p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">2. Descripción del servicio</h2>
          <p>
            Mimoia es una plataforma de planificación de menús semanales que genera recomendaciones
            personalizadas basadas en tus preferencias alimentarias. El servicio incluye generación
            de menús, lista de la compra y acceso a recetas.
          </p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">3. Para qué sirve Mimoia</h2>
          <p data-testid="terms-intended-purpose">{INTENDED_PURPOSE}</p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">4. Registro y cuenta</h2>
          <p>
            Para usar Mimoia necesitas crear una cuenta con información veraz. Eres responsable de
            mantener la seguridad de tu contraseña y de toda la actividad que ocurra bajo tu cuenta.
          </p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">5. Uso aceptable</h2>
          <p>Te comprometes a:</p>
          <ul className="ml-6 list-disc space-y-2">
            <li>Usar el servicio solo para fines personales y no comerciales</li>
            <li>No intentar acceder a cuentas de otros usuarios</li>
            <li>No usar el servicio para actividades ilegales</li>
            <li>No intentar descompilar o realizar ingeniería inversa del software</li>
          </ul>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">6. Aviso sobre salud</h2>
          <p>
            Mimoia no es un servicio médico ni nutricional profesional. Las recomendaciones de menús
            son orientativas y no sustituyen el consejo de un médico, nutricionista o profesional
            de la salud. Si tienes condiciones médicas, alergias graves u otras necesidades
            dietéticas específicas, consulta a un profesional antes de seguir cualquier plan
            alimentario.
          </p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">7. Propiedad intelectual</h2>
          <p>
            Todo el contenido de Mimoia (textos, diseño, logotipos, software) es propiedad de Mimoia
            o de sus licenciantes y está protegido por las leyes de propiedad intelectual.
          </p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">8. Precio y pagos</h2>
          <p>
            Mimoia se ofrece por suscripción, por hogar, con dos planes, Esencial y Plus, que pueden
            pagarse al mes o al año. Los precios vigentes, con el IVA incluido, y lo que incluye cada
            plan están en la página de <Link href="/precios" className="underline">Precios</Link>.
            La suscripción se renueva sola al final de cada periodo hasta que la canceles.
          </p>
          <p>
            El cobro lo gestiona Stripe a través de Link, que actúa como vendedor registrado: cobra el
            importe, emite los recibos y en el extracto aparece «LINK.COM* MIMOIA». Nosotros no vemos
            ni guardamos los datos de tu tarjeta.
          </p>
          <p>
            Desde que te registras tienes 14 días de prueba con todo, sin tarjeta; si estás en la beta, esos 14 días
            empiezan el día de la salida, el 15 de diciembre de 2026. Si dejas tu plan pagado antes, guardas la tarjeta y
            el primer cobro se hace al acabar tu prueba (en la beta, el 29 de diciembre de 2026), y nunca antes de 15 días
            desde que dejaste la tarjeta. Si cancelas antes, no se cobra nada.
            Si cambiamos el precio, te avisaremos con al menos 30 días de antelación; el precio de
            fundador se mantiene mientras sigas suscrito, con las condiciones de tu plan.
          </p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">9. Cancelación</h2>
          <p>
            Puedes cancelar tu suscripción cuando quieras desde Perfil → Suscripción → «Gestionar mi
            suscripción». Sigues teniendo tu plan hasta el final del periodo ya pagado y no se vuelve
            a cobrar. Si borras tu cuenta, la suscripción que pagas se cancela en ese momento.
          </p>
          <p>
            También puedes borrar tu cuenta en cualquier momento desde tu perfil. Al hacerlo pierdes
            el acceso a tu menú, tus listas de la compra y tu historial de recetas.
          </p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">10. Limitación de responsabilidad</h2>
          <p>
            Mimoia se proporciona &quot;tal cual&quot;. No garantizamos que el servicio sea
            ininterrumpido, seguro o libre de errores. En la máxima medida permitida por la ley,
            no seremos responsables de daños indirectos, incidentales o consecuentes.
          </p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">11. Cambios en los términos</h2>
          <p>
            Podemos modificar estos términos en cualquier momento. Los cambios relevantes se
            notificarán por correo electrónico o mediante aviso en la plataforma. El uso continuado
            del servicio después de los cambios implica su aceptación.
          </p>

          <h2 className="text-h3 mt-10 text-[#1A1A1A]">12. Contacto</h2>
          <p>
            Para cualquier consulta sobre estos términos, escríbenos a{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-4">{CONTACT_EMAIL}</a>.
          </p>
        </div>
      </div>
    </div>
  )
}
