import Link from "next/link"

export default function Footer() {
  return (
    <footer className="bg-[#1B4332] py-16 text-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 md:grid-cols-3">
        {/* Col 1: Logo + tagline */}
        <div>
          <Link
            href="/"
            className="font-[family-name:var(--font-display)] text-2xl text-white"
          >
            ONA
          </Link>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            Tu menu semanal listo en 2 minutos.
            <br />
            Con la lista de la compra incluida.
          </p>
        </div>

        {/* Col 2: Links */}
        <div>
          <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/50">
            Navegacion
          </h4>
          <ul className="space-y-3">
            <li>
              <Link href="/como-funciona" className="text-sm text-white/80 transition-colors hover:text-white">
                Como funciona
              </Link>
            </li>
            <li>
              <Link href="/recetas" className="text-sm text-white/80 transition-colors hover:text-white">
                Recetas
              </Link>
            </li>
            <li>
              <Link href="/privacidad" className="text-sm text-white/80 transition-colors hover:text-white">
                Privacidad
              </Link>
            </li>
            <li>
              <Link href="/terminos" className="text-sm text-white/80 transition-colors hover:text-white">
                Terminos
              </Link>
            </li>
          </ul>
        </div>

        {/* Col 3: Legal */}
        <div>
          <h4 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white/50">
            Legal
          </h4>
          <p className="text-sm leading-relaxed text-white/60">
            &copy; {new Date().getFullYear()} ONA. Todos los derechos reservados.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/60">
            ONA no sustituye el consejo de un profesional de la salud. Consulta a tu medico o nutricionista ante cualquier duda.
          </p>
        </div>
      </div>
    </footer>
  )
}
