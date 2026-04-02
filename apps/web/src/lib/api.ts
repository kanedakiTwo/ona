const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

interface FetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { body, headers: customHeaders, ...rest } = options

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(customHeaders as Record<string, string>),
  }

  if (typeof window !== "undefined") {
    const token = localStorage.getItem("ona_token")
    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    headers,
    body: body ? JSON.stringify(body) : undefined,
    ...rest,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error ?? error.message ?? error.detail ?? `Request failed: ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export const api = {
  get<T = unknown>(path: string) {
    return apiFetch<T>(path, { method: "GET" })
  },

  post<T = unknown>(path: string, body?: unknown) {
    return apiFetch<T>(path, { method: "POST", body })
  },

  put<T = unknown>(path: string, body?: unknown) {
    return apiFetch<T>(path, { method: "PUT", body })
  },

  delete<T = unknown>(path: string) {
    return apiFetch<T>(path, { method: "DELETE" })
  },
}
