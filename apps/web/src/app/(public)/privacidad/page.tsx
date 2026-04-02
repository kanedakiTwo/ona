export default function PrivacidadPage() {
  return (
    <div className="mx-auto max-w-[720px] px-4 py-16 md:py-24">
      <h1 className="text-h1 mb-8 text-[#1B4332]">Politica de Privacidad</h1>

      <div className="prose-ona space-y-6 text-[#444444] leading-relaxed">
        <p className="text-sm text-[#777777]">Ultima actualizacion: abril 2026</p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">1. Responsable del tratamiento</h2>
        <p>
          ONA (&quot;nosotros&quot;, &quot;nuestro&quot;) es responsable del tratamiento de los datos
          personales recogidos a traves de esta plataforma. Si tienes preguntas sobre como tratamos
          tus datos, puedes escribirnos a privacidad@ona.app.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">2. Datos que recogemos</h2>
        <p>
          Recogemos los datos que nos proporcionas directamente al crear tu cuenta y al usar el
          servicio: nombre, correo electronico, preferencias alimentarias, restricciones dieteticas
          y datos de uso del menu semanal.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">3. Finalidad del tratamiento</h2>
        <p>Usamos tus datos para:</p>
        <ul className="ml-6 list-disc space-y-2">
          <li>Generar tu menu semanal personalizado</li>
          <li>Crear tu lista de la compra</li>
          <li>Mejorar nuestras recomendaciones con el tiempo</li>
          <li>Enviarte comunicaciones sobre el servicio (si lo autorizas)</li>
        </ul>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">4. Base legal</h2>
        <p>
          El tratamiento de tus datos se basa en tu consentimiento al crear tu cuenta y en la
          ejecucion del contrato de servicio. Puedes retirar tu consentimiento en cualquier momento
          desde la configuracion de tu perfil.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">5. Comparticion de datos</h2>
        <p>
          No vendemos tus datos personales. Podemos compartir datos con proveedores de servicios
          que nos ayudan a operar la plataforma (alojamiento, envio de correos), siempre bajo
          acuerdos de confidencialidad.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">6. Retencion de datos</h2>
        <p>
          Conservamos tus datos mientras mantengas tu cuenta activa. Si eliminas tu cuenta,
          borraremos tus datos personales en un plazo de 30 dias, salvo obligacion legal de
          conservarlos.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">7. Tus derechos</h2>
        <p>
          Tienes derecho a acceder, rectificar, eliminar y portar tus datos, asi como a oponerte
          o limitar su tratamiento. Para ejercer estos derechos, escribenos a privacidad@ona.app.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">8. Cookies</h2>
        <p>
          Usamos cookies esenciales para el funcionamiento del servicio y cookies analiticas para
          entender como se usa la plataforma. Puedes gestionar tus preferencias de cookies desde
          la configuracion de tu navegador.
        </p>

        <h2 className="text-h3 mt-10 text-[#1A1A1A]">9. Cambios en esta politica</h2>
        <p>
          Podemos actualizar esta politica periodicamente. Te notificaremos de cambios relevantes
          por correo electronico o mediante un aviso en la plataforma.
        </p>
      </div>
    </div>
  )
}
