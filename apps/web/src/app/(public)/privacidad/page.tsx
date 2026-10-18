import Link from "next/link"
import { LEGAL_OWNER } from "@ona/shared"

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
    <>la persona de Mimoia que te invitó a la beta</>
  )
}

const H2 = ({ children, id }: { children: React.ReactNode; id?: string }) => (
  <h2 id={id} className="mt-10 scroll-mt-28 font-display text-2xl text-[#1A1612]">{children}</h2>
)

export default function PrivacidadPage() {
  return (
    <div className="public-container pb-16 pt-28 md:pb-24 md:pt-32">
      <div className="max-w-[720px]" data-testid="reading-column">
        <h1 className="font-display text-4xl text-[#1A1612] md:text-5xl">Política de privacidad</h1>

        <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-[#4A4239]">
          <p className="text-sm text-[#7A7066]">Última actualización: 19 de octubre de 2026</p>

          <H2>1. Quién trata tus datos</H2>
          <p data-testid="privacy-controller">
            El responsable del tratamiento es {LEGAL_OWNER.name}, con NIF {LEGAL_OWNER.nif} y domicilio en{" "}
            {LEGAL_OWNER.address}, titular de Mimoia (ver el <Link href="/aviso-legal" className="underline underline-offset-4">aviso legal</Link>).
            Para cualquier cuestión sobre tus datos o para ejercer tus derechos, escribe a <Contact />.
          </p>

          <H2>2. Qué datos tratamos</H2>
          <ul className="ml-5 list-disc space-y-2">
            <li><strong>Cuenta:</strong> nombre de usuario, email y contraseña (guardada cifrada, nunca en claro).</li>
            <li>
              <strong>Datos de salud y alimentación:</strong> sexo, edad, peso, altura y nivel de actividad
              (para calcular tus calorías), alergias, intolerancias y restricciones (para que Mimoia no te
              proponga lo que no puedes comer), gustos y lo que cocinas. Las alergias y los datos físicos son
              datos de salud: solo los tratamos porque tú nos los das, con tu consentimiento explícito, y
              puedes borrarlos cuando quieras desde tu perfil.
            </li>
            <li><strong>Tu uso de Mimoia:</strong> menús, lista de la compra, despensa, recetas propias y fotos que subas.</li>
            <li data-testid="privacy-signup-shopping">
              <strong>Lo que nos cuentas al darte de alta y lo que compras.</strong> Si escribes algo con tus palabras al
              darte de alta (lo que os gusta, cómo cocináis) y los productos que marcas en la lista de la compra, los usamos
              para conocer los gustos de tu hogar y ajustar tu menú. Los analiza una inteligencia artificial de Anthropic,
              que trabaja para nosotros como encargada del tratamiento. No escribas ahí datos de salud: para alergias e
              intolerancias está el apartado de salud, que pide tu permiso. Lo guardamos mientras tengas la cuenta.
            </li>
            <li>
              <strong>Tus opiniones sobre Mimoia:</strong> lo que nos cuentas desde el botón «Opinión» o le dices a Mimo
              para el equipo (sugerencias, fallos, quejas), con la página desde la que lo enviaste.
            </li>
            <li>
              <strong>Tu plan y tu opinión del precio:</strong> si te suscribes, el plan, su estado y sus fechas (el pago lo
              gestiona Stripe, ver el punto 5); y, si contestas la encuesta de precio de la beta, tus respuestas en euros
              al mes.
            </li>
            <li>
              <strong>Conversaciones con el asistente</strong> (chat, voz y WhatsApp): el texto de los mensajes y la
              transcripción de las notas de voz. Si conectas WhatsApp, también tu número de teléfono.{' '}
              <span data-testid="privacy-web-chat">
                Lo que hablas con Mimo en la web (lo que le escribes o le dices, lo que te responde y lo que hizo por
                ti) se guarda durante 90 días y después se borra solo.
              </span>
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
            <li>
              Preparar la ficha de tu hogar (vuestros gustos y costumbres a la hora de comer) a partir de lo que hablas
              con Mimo en la web y por WhatsApp, para que tus menús y sus respuestas se ajusten mejor a vosotros.
            </li>
            <li>Revisar, de forma interna, conversaciones de WhatsApp para detectar errores del asistente y corregirlos.</li>
            <li>Controlar el gasto en IA por usuario y mantener el servicio seguro.</li>
            <li>Detectar y arreglar los fallos de la aplicación, con un registro propio que no se comparte con terceros.</li>
            <li>Si lo pides (al registrarte o en tu perfil), mandarte cada viernes el menú de la semana por email.</li>
            <li>Cobrar tu suscripción, si tienes una, y decidir los precios con lo que opina la beta.</li>
          </ul>
          <p>
            No vendemos tus datos ni los usamos para publicidad de terceros. Mimoia es un asistente con inteligencia
            artificial: puede equivocarse y no sustituye a un profesional sanitario.
          </p>

          <H2>4. Base legal</H2>
          <p>
            La ejecución del servicio que pides al registrarte y, para los datos de salud, tu consentimiento
            explícito (art. 9.2.a RGPD), que puedes retirar en cualquier momento borrando esos datos o tu cuenta.
            Los avisos proactivos por WhatsApp solo se envían si los activas, y puedes darte de baja escribiendo BAJA.
            El menú de los viernes por email es un consentimiento aparte (art. 6.1.a RGPD y art. 21 de la LSSI): lo
            quitas en tu
            perfil o con el enlace de cada email.
          </p>

          <H2>5. Con quién los compartimos</H2>
          <p>Solo con los proveedores que hacen funcionar Mimoia, que tratan los datos por cuenta nuestra:</p>
          <ul className="ml-5 list-disc space-y-2">
            <li><strong>Anthropic</strong> (modelos Claude): el asistente, la lectura de recetas desde enlaces y fotos, y las estimaciones nutricionales.</li>
            <li><strong>OpenAI</strong>: transcripción de lo que le dices a Mimo con la voz y de las notas de voz de WhatsApp; y, si AiKit no está disponible, generación de imágenes de recetas (solo recibe el nombre y los ingredientes de la receta).</li>
            <li><strong>ElevenLabs</strong>: la voz de Mimo cuando lee sus respuestas en voz alta (solo recibe el texto de la respuesta).</li>
            <li><strong>Meta (WhatsApp Business)</strong>: si conectas WhatsApp, para enviar y recibir los mensajes.</li>
            <li><strong>Railway</strong>: alojamiento de la aplicación y de la base de datos.</li>
            <li><strong>AiKit</strong>: generación de imágenes de recetas cuando lo pides (solo recibe el nombre e ingredientes de la receta).</li>
            <li><strong>Cloudflare</strong>: estadísticas agregadas de visitas a la web, sin cookies (ver el punto 8).</li>
            <li><strong>Resend</strong> (empresa de EE. UU.): el envío de los emails de Mimoia, como la invitación de la lista de espera y el menú de los viernes. Recibe tu email, tu nombre y el contenido del mensaje. Los correos salen desde servidores de la Unión Europea, pero Resend puede tratar los datos en Estados Unidos.</li>
            <li><strong>Stripe (a través de Link)</strong>: el cobro de las suscripciones. Recibe tu email y, cuando pagas, los datos de pago que escribes directamente en su página; Link actúa como vendedor registrado y emite los recibos. Nosotros guardamos solo el plan, su estado, sus fechas y las referencias de Stripe, nunca tu tarjeta.</li>
          </ul>
          <p>
            Algunos de estos proveedores están en Estados Unidos. Las transferencias se amparan en el Marco de
            Privacidad de Datos UE-EE. UU. o en cláusulas contractuales tipo de la Comisión Europea.
          </p>

          <H2>6. Cuánto tiempo</H2>
          <p>
            Mientras tengas la cuenta, salvo el chat con Mimo en la web, que se borra solo a los 90 días. Puedes
            borrar la cuenta tú mismo en <strong>Perfil → Borrar mi cuenta</strong>: se eliminan al momento tu perfil, tus
            menús, tu memoria, tus recetas propias, tus conversaciones con Mimo en la web y tu historial de WhatsApp. Si
            compartes hogar, el hogar sigue para los demás miembros. Los registros de costes y de fallos se conservan
            sin vincularlos a ti. Si pagas una suscripción, se cancela en ese momento; Stripe y Link conservan los
            recibos el tiempo que exige la ley fiscal.
          </p>

          <H2>7. Tus derechos</H2>
          <p>
            Puedes acceder a tus datos, corregirlos, borrarlos, llevártelos, limitar su uso u oponerte, escribiendo
            a <Contact />. Si crees que no los tratamos bien, puedes reclamar ante la Agencia Española de Protección
            de Datos (aepd.es).
          </p>

          <H2>8. Cookies y almacenamiento local</H2>
          <p>
            Mimoia no usa cookies de publicidad ni de analítica. Guarda en tu navegador tu sesión y algunas
            preferencias de pantalla, y una copia de tu menú y tu lista para que funcionen sin conexión. La sesión y
            esa copia se borran al cerrar sesión.
          </p>
          <p data-testid="privacy-web-analytics">
            Para saber cuántas personas visitan la web usamos Cloudflare Web Analytics, que cuenta las visitas de
            forma agregada (páginas vistas, país, tipo de dispositivo) sin cookies, sin guardar nada en tu navegador y
            sin crear un perfil tuyo. Dentro de la app contamos, también solo de forma agregada, qué funciones se usan
            (por ejemplo, cuántos menús se generan) para saber qué mejorar; esos registros se borran a los 180 días.
          </p>

          <H2>9. Menores</H2>
          <p>Mimoia no está dirigida a menores de 14 años.</p>

          <H2>10. Cambios</H2>
          <p>Si cambiamos esta política de forma relevante, te lo diremos en la app antes de que se aplique.</p>

          <H2 id="lista-de-espera">11. Lista de espera</H2>
          <p>Si te apuntas a la lista de espera de la web, antes de tener cuenta, tratamos solo esto:</p>
          <ul className="ml-5 list-disc space-y-2">
            <li>Tu email y, si nos lo das, tu nombre.</li>
            <li>
              Tus respuestas a cuatro preguntas: cuántos sois en casa, quién planifica y hace la compra, cómo lo
              organizas hoy y qué móvil usas. Y, si lo dices, dónde sueles comprar y si te interesa usarlo por
              WhatsApp. No te preguntamos nada de salud.
            </li>
            <li>
              Cómo llegaste: el enlace de quien te invitó, si fue así, y la página o campaña de origen (los
              parámetros <code>ref</code> y <code>utm</code> del enlace). Y cuándo nos diste tu consentimiento.
            </li>
            <li>
              Solo si te apuntaste antes del 15 de octubre de 2026 y las contestaste: tus respuestas a cuatro
              preguntas opcionales sobre el precio (en euros al mes) y, si reservaste una plaza de fundador, el plan y
              el periodo que elegiste; o, si ninguno te encajaba, el motivo. Ya no las preguntamos en la lista.
            </li>
          </ul>
          <p>
            <strong>Para qué:</strong> para invitarte por tandas y para preguntarte por tus hábitos y así diseñar el
            producto. Con tus respuestas decidimos a quién invitamos primero, y con tu enlace de invitación contamos
            cuántas personas se apuntan gracias a ti (en tu página solo se ve ese número, nunca quiénes son).
          </p>
          <p>
            <strong>El menú de los viernes:</strong> si además marcas la casilla «Quiero recibir cada viernes por
            email una receta de la semana y novedades de Mimoia», usamos tu email también para mandarte ese correo. Es opcional, va aparte
            de la lista y puedes retirarlo en cualquier momento con un clic.
          </p>
          <p>
            <strong>Base legal:</strong> tu consentimiento (art. 6.1.a RGPD), que das al marcar la casilla de
            privacidad y puedes retirar cuando quieras. Para el email de los viernes, un consentimiento aparte
            (art. 21 de la LSSI).
          </p>
          <p data-testid="privacy-waitlist-retention">
            <strong>Cuánto tiempo:</strong> hasta el 16 de mayo de 2027 (seis meses después de abrir el registro a
            todo el mundo, el 16 de noviembre de 2026) o hasta que te des de baja, lo que ocurra antes. Si pediste el
            menú de los viernes, guardamos tu email para ese correo mientras no te des de baja. Si te invitamos y
            creas una cuenta, desde ese momento se aplica el resto de esta política.
          </p>
          <p>
            <strong>Cómo darte de baja:</strong> con un clic en el enlace de baja que te damos al apuntarte y que va
            en cada email que te mandemos, o escribiendo al contacto del apartado 1. Al darte de baja borramos tu
            email y tu nombre, dejas de recibir el menú de los viernes y solo guardamos las respuestas, sin nada que
            te identifique, para las cuentas.
          </p>
          <p>
            <strong>Solo el menú de los viernes:</strong> cada uno de esos emails lleva un enlace para dejar de
            recibirlo sin salir de la lista. Tu sitio en la lista sigue igual.
          </p>
          <p>
            Los datos de la lista se guardan en Railway (nuestro alojamiento). Los emails que te mandamos (la
            invitación y, si lo pediste, el menú de los viernes) salen a través de Resend, que recibe tu email, tu
            nombre y el mensaje. No se comparten con nadie más ni se usan para publicidad de terceros.
          </p>
        </div>
      </div>
    </div>
  )
}
