"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import { api } from "@/lib/api"

interface User {
  id: string
  username: string
  email: string
  onboardingDone: boolean
  [key: string]: any
}

interface AuthState {
  token: string | null
  user: User | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
  updateUser: (updates: Partial<User>) => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

interface AuthResponse {
  token: string
  user: User
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const storedToken = localStorage.getItem("ona_token")
    const storedUser = localStorage.getItem("ona_user")

    if (storedToken && storedUser) {
      setToken(storedToken)
      try {
        setUser(JSON.parse(storedUser))
      } catch {
        localStorage.removeItem("ona_token")
        localStorage.removeItem("ona_user")
      }
    }

    setIsLoading(false)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post<AuthResponse>("/login", { username, password })
    localStorage.setItem("ona_token", data.token)
    localStorage.setItem("ona_user", JSON.stringify(data.user))
    setToken(data.token)
    setUser(data.user)
  }, [])

  const register = useCallback(
    async (username: string, email: string, password: string) => {
      const data = await api.post<AuthResponse>("/register", {
        username,
        email,
        password,
      })
      localStorage.setItem("ona_token", data.token)
      localStorage.setItem("ona_user", JSON.stringify(data.user))
      setToken(data.token)
      setUser(data.user)
    },
    []
  )

  const logout = useCallback(() => {
    localStorage.removeItem("ona_token")
    localStorage.removeItem("ona_user")
    setToken(null)
    setUser(null)
  }, [])

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev
      const updated = { ...prev, ...updates }
      localStorage.setItem("ona_user", JSON.stringify(updated))
      return updated
    })
  }, [])

  return (
    <AuthContext.Provider value={{ token, user, isLoading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

export { AuthContext }
