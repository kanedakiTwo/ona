import { clearSessionData } from "@/lib/pwa/sessionData"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

/** 401 codes after which the stored session is useless: log out locally. */
const AUTH_RESET_CODES = new Set(['USER_NOT_FOUND', 'TOKEN_EXPIRED', 'INVALID_TOKEN'])

interface FetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown
}

/** Shape of one lint issue returned by the API on 422 from recipe writes. */
export interface LintIssuePayload {
  code: string
  message: string
  /** Dot-path into the recipe shape, e.g. 'steps[3].text' or 'ingredients[0]'. Missing for top-level errors. */
  path?: string
}

/**
 * Thrown by `apiFetch` when the server returns 422 with a `{ errors }` array
 * (POST/PUT /recipes lint failures). Carries the structured issues so the
 * form can pin each one to its specific row/step.
 */
/**
 * Any non-2xx response. `status` + `code` let callers tell a real 404 ("no
 * menu this week") from a failure (500, offline) — treating both as "empty"
 * is how a failed GET used to auto-create an empty week over a real one.
 */
export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export class LintFailureError extends Error {
  issues: LintIssuePayload[]
  constructor(issues: LintIssuePayload[]) {
    const summary = issues
      .map((e) => (e.path ? `${e.message} (${e.path})` : e.message))
      .join(' · ')
    super(summary)
    this.name = 'LintFailureError'
    this.issues = issues
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions & { anonymous?: boolean } = {}
): Promise<T> {
  const { body, headers: customHeaders, anonymous, ...rest } = options

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(customHeaders as Record<string, string>),
  }

  // Public endpoints (/recipes-ona, future SEO pages) opt out of the token
  // so the same logged-in browser sees the anonymous catalogue per spec.
  if (!anonymous && typeof window !== "undefined") {
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

    // Stale token (signed by us but for a deleted user, e.g. after a reseed),
    // an expired one, or one the API no longer accepts (JWT_SECRET rotated):
    // wipe local auth and bounce to /login so the user can recover without
    // every authed request landing on a confusing error.
    if (
      response.status === 401 &&
      AUTH_RESET_CODES.has(error?.code) &&
      typeof window !== 'undefined'
    ) {
      localStorage.removeItem('ona_token')
      localStorage.removeItem('ona_user')
      await clearSessionData()
      // Avoid a redirect loop if we're already on the login page.
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login')
      }
    }

    // 422 from POST/PUT /recipes carries `{ errors: LintIssue[] }`. Throw a
    // typed error so the caller can route each issue to the right field
    // instead of swallowing them as "Request failed: 422".
    if (Array.isArray(error.errors) && error.errors.length > 0) {
      throw new LintFailureError(error.errors)
    }

    throw new ApiError(
      error.error ?? error.message ?? error.detail ?? `Request failed: ${response.status}`,
      response.status,
      typeof error?.code === 'string' ? error.code : undefined,
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

/**
 * Same surface as `api` but never sends the Authorization header. Use it
 * for public-mode pages (e.g. /recipes-ona) so a logged-in browser still
 * receives the anonymous catalogue.
 */
export const apiPublic = {
  get<T = unknown>(path: string) {
    return apiFetch<T>(path, { method: "GET", anonymous: true })
  },
  /** Public writes (e.g. the waitlist) — never tied to whoever is logged in on this browser. */
  post<T = unknown>(path: string, body?: unknown) {
    return apiFetch<T>(path, { method: "POST", body, anonymous: true })
  },
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

  patch<T = unknown>(path: string, body?: unknown) {
    return apiFetch<T>(path, { method: "PATCH", body })
  },

  delete<T = unknown>(path: string, body?: unknown) {
    return apiFetch<T>(path, { method: "DELETE", body })
  },

  async upload<T = unknown>(path: string, formData: FormData): Promise<T> {
    const headers: Record<string, string> = {}

    if (typeof window !== "undefined") {
      const token = localStorage.getItem("ona_token")
      if (token) {
        headers["Authorization"] = `Bearer ${token}`
      }
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers,
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error ?? error.message ?? `Request failed: ${response.status}`)
    }

    return response.json() as Promise<T>
  },
}
