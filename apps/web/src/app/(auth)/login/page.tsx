"use client"

import { useAuth } from "@/lib/auth"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"
import Link from "next/link"

export default function LoginPage() {
  const { login } = useAuth()
  const router = useRouter()

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      await login(username, password)
      router.push("/")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesion")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8">
        <h1 className="text-h2 text-[#1A1A1A]">Iniciar sesion</h1>
        <p className="mt-1 text-sm text-[#777777]">
          Entra en tu cuenta de ONA
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
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-[#777777]">
          No tienes cuenta?{" "}
          <Link href="/register" className="font-medium text-[#2D6A4F] hover:underline">
            Registrate
          </Link>
        </p>
      </div>
    </div>
  )
}
