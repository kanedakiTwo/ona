"use client"

import { useAuth } from "@/lib/auth"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import Link from "next/link"

export default function RegisterPage() {
  const { register } = useAuth()
  const router = useRouter()

  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await register(username, email, password)
      router.push("/onboarding")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrarse")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8">
        <h1 className="text-h2 text-[#1A1A1A]">Crear cuenta</h1>
        <p className="mt-1 text-sm text-[#777777]">
          Registrate en ONA y empieza a planificar
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-[#FDEEE8] p-3 text-sm text-[#B5451B]">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium text-[#444444]"
            >
              Usuario
            </label>
            <input
              id="username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-ona mt-1 block w-full"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-[#444444]"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-ona mt-1 block w-full"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-[#444444]"
            >
              Contrasena
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-ona mt-1 block w-full"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary btn-m w-full"
          >
            {isSubmitting ? "Creando cuenta..." : "Crear cuenta"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-[#777777]">
          Ya tienes cuenta?{" "}
          <Link href="/login" className="font-medium text-[#2D6A4F] hover:underline">
            Inicia sesion
          </Link>
        </p>
      </div>
    </div>
  )
}
