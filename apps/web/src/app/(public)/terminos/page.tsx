import { CONTACT_EMAIL } from "@/lib/contact"

export default function TerminosPage() {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-16 md:py-24">
      <h1 className="text-h1 mb-8 text-[#1B4332]">Términos y condiciones</h1>

      <div className="prose-ona space-y-6 text-[#444444] leading-relaxed">
        <p className="text-sm text-[#777777]">Última actualización: abril 2026</p>

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

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">3. Registro y cuenta</h2>
        <p>
          Para usar Mimoia necesitas crear una cuenta con información veraz. Eres responsable de
          mantener la seguridad de tu contraseña y de toda la actividad que ocurra bajo tu cuenta.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">4. Uso aceptable</h2>
        <p>Te comprometes a:</p>
        <ul className="ml-6 list-disc space-y-2">
          <li>Usar el servicio solo para fines personales y no comerciales</li>
          <li>No intentar acceder a cuentas de otros usuarios</li>
          <li>No usar el servicio para actividades ilegales</li>
          <li>No intentar descompilar o realizar ingeniería inversa del software</li>
        </ul>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">5. Aviso sobre salud</h2>
        <p>
          Mimoia no es un servicio médico ni nutricional profesional. Las recomendaciones de menús
          son orientativas y no sustituyen el consejo de un médico, nutricionista o profesional
          de la salud. Si tienes condiciones médicas, alergias graves u otras necesidades
          dietéticas específicas, consulta a un profesional antes de seguir cualquier plan
          alimentario.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">6. Propiedad intelectual</h2>
        <p>
          Todo el contenido de Mimoia (textos, diseño, logotipos, software) es propiedad de Mimoia
          o de sus licenciantes y está protegido por las leyes de propiedad intelectual.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">7. Precio y pagos</h2>
        <p>
          Mimoia ofrece un plan gratuito con funcionalidades básicas. Los planes de pago, si los
          hubiera, se facturarán según los precios publicados en la plataforma. Nos reservamos
          el derecho de modificar los precios con preaviso de 30 días.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">8. Cancelación</h2>
        <p>
          Puedes cancelar tu cuenta en cualquier momento desde la configuración de tu perfil.
          Al cancelar, perderás acceso a tu menú, listas de la compra e historial de recetas.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">9. Limitación de responsabilidad</h2>
        <p>
          Mimoia se proporciona &quot;tal cual&quot;. No garantizamos que el servicio sea
          ininterrumpido, seguro o libre de errores. En la máxima medida permitida por la ley,
          no seremos responsables de daños indirectos, incidentales o consecuentes.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">10. Cambios en los términos</h2>
        <p>
          Podemos modificar estos términos en cualquier momento. Los cambios relevantes se
          notificarán por correo electrónico o mediante aviso en la plataforma. El uso continuado
          del servicio después de los cambios implica su aceptación.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">11. Contacto</h2>
        <p>
          Para cualquier consulta sobre estos términos, escríbenos a{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline underline-offset-4">{CONTACT_EMAIL}</a>.
        </p>
      </div>
    </div>
  )
}
