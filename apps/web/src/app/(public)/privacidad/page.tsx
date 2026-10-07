/**
 * Política de privacidad. Describes what the code actually does (see
 * specs/privacy.md). Pending legal review: the controller's legal identity
 * and the contact address come from Miguel (CLAUDE.md → Todo Miguel).
 */
const CONTACT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL

function Contact() {
  return CONTACT ? (
    <a href={`mailto:${CONTACT}`} className="underline underline-offset-4">
      {CONTACT}
    </a>
  ) : (
    // Until NEXT_PUBLIC_SUPPORT_EMAIL is set (beta, invitation only).
    <>la persona de ONA que te invitó a la beta</>
  )
}

const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mt-10 font-display text-2xl text-[#1A1612]">{children}</h2>
)

export default function PrivacidadPage() {
  return (
    <div className="mx-auto max-w-[720px] px-4 pb-16 pt-28 md:pb-24 md:pt-32">
      <h1 className="font-display text-4xl text-[#1A1612] md:text-5xl">Política de privacidad</h1>

      <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-[#4A4239]">
        <p className="text-sm text-[#7A7066]">Última actualización: 7 de octubre de 2026</p>

        <H2>1. Quién trata tus datos</H2>
        <p>
          El responsable del tratamiento es el equipo de ONA. Para cualquier cuestión sobre tus datos
          o para ejercer tus derechos, escribe a <Contact />.
        </p>

        <H2>2. Qué datos tratamos</H2>
        <ul className="ml-5 list-disc space-y-2">
          <li><strong>Cuenta:</strong> nombre de usuario, email y contraseña (guardada cifrada, nunca en claro).</li>
          <li>
            <strong>Datos de salud y alimentación:</strong> sexo, edad, peso, altura y nivel de actividad
            (para calcular tus calorías), alergias, intolerancias y restricciones (para que ONA no te
            proponga lo que no puedes comer), gustos y lo que cocinas. Las alergias y los datos físicos son
            datos de salud: solo los tratamos porque tú nos los das, con tu consentimiento explícito, y
            puedes borrarlos cuando quieras desde tu perfil.
          </li>
          <li><strong>Tu uso de ONA:</strong> menús, lista de la compra, despensa, recetas propias y fotos que subas.</li>
          <li>
            <strong>Conversaciones con el asistente</strong> (chat, voz y WhatsApp): el texto de los mensajes y la
            transcripción de las notas de voz. Si conectas WhatsApp, también tu número de teléfono.
          </li>
          <li>
            <strong>Datos técnicos:</strong> suscripción a notificaciones push, un registro del coste de cada uso de
            la IA y un registro de los fallos de la aplicación (el mensaje técnico, la página y el tipo de
            navegador; sin tu IP, sin lo que escribes y quitando emails, teléfonos y claves).
          </li>
        </ul>

        <H2>3. Para qué</H2>
        <ul className="ml-5 list-disc space-y-2">
          <li>Generar tu menú semanal, la lista de la compra y los avisos que hayas activado.</li>
          <li>Responder a lo que le pidas al asistente y hacer los cambios que le pidas.</li>
          <li>Revisar, de forma interna, conversaciones de WhatsApp para detectar errores del asistente y corregirlos.</li>
          <li>Controlar el gasto en IA por usuario y mantener el servicio seguro.</li>
          <li>Detectar y arreglar los fallos de la aplicación, con un registro propio que no se comparte con terceros.</li>
        </ul>
        <p>
          No vendemos tus datos ni los usamos para publicidad. ONA es un asistente con inteligencia
          artificial: puede equivocarse y no sustituye a un profesional sanitario.
        </p>

        <H2>4. Base legal</H2>
        <p>
          La ejecución del servicio que pides al registrarte y, para los datos de salud, tu consentimiento
          explícito (art. 9.2.a RGPD), que puedes retirar en cualquier momento borrando esos datos o tu cuenta.
          Los avisos proactivos por WhatsApp solo se envían si los activas, y puedes darte de baja escribiendo BAJA.
        </p>

        <H2>5. Con quién los compartimos</H2>
        <p>Solo con los proveedores que hacen funcionar ONA, que tratan los datos por cuenta nuestra:</p>
        <ul className="ml-5 list-disc space-y-2">
          <li><strong>Anthropic</strong> (modelos Claude): el asistente, la lectura de recetas desde enlaces y fotos, y las estimaciones nutricionales.</li>
          <li><strong>OpenAI</strong>: transcripción de notas de voz y el modo de conversación por voz.</li>
          <li><strong>Meta (WhatsApp Business)</strong>: si conectas WhatsApp, para enviar y recibir los mensajes.</li>
          <li><strong>Railway</strong>: alojamiento de la aplicación y de la base de datos.</li>
          <li><strong>AiKit</strong>: generación de imágenes de recetas cuando lo pides (solo recibe el nombre e ingredientes de la receta).</li>
        </ul>
        <p>
          Algunos de estos proveedores están en Estados Unidos. Las transferencias se amparan en el Marco de
          Privacidad de Datos UE-EE. UU. o en cláusulas contractuales tipo de la Comisión Europea.
        </p>

        <H2>6. Cuánto tiempo</H2>
        <p>
          Mientras tengas la cuenta. Puedes borrarla tú mismo en <strong>Perfil → Borrar mi cuenta</strong>: se
          eliminan al momento tu perfil, tus menús, tu memoria, tus recetas propias y tu historial de WhatsApp. Si
          compartes hogar, el hogar sigue para los demás miembros. Los registros de costes y de fallos se conservan
          sin vincularlos a ti.
        </p>

        <H2>7. Tus derechos</H2>
        <p>
          Puedes acceder a tus datos, corregirlos, borrarlos, llevártelos, limitar su uso u oponerte, escribiendo
          a <Contact />. Si crees que no los tratamos bien, puedes reclamar ante la Agencia Española de Protección
          de Datos (aepd.es).
        </p>

        <H2>8. Cookies y almacenamiento local</H2>
        <p>
          ONA no usa cookies de publicidad ni de analítica. Guarda en tu navegador tu sesión y algunas
          preferencias de pantalla, y una copia de tu menú y tu lista para que funcionen sin conexión. La sesión y
          esa copia se borran al cerrar sesión.
        </p>

        <H2>9. Menores</H2>
        <p>ONA no está dirigida a menores de 14 años.</p>

        <H2>10. Cambios</H2>
        <p>Si cambiamos esta política de forma relevante, te lo diremos en la app antes de que se aplique.</p>
      </div>
    </div>
  )
}
