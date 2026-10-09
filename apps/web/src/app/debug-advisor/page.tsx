'use client'

import { useState, useEffect } from 'react'
import { DISPLAY_UI } from '@/components/recipes/RecipeCard'

export default function DebugAdvisorPage() {
  const [info, setInfo] = useState<string>('Checking...')
  const [apiResult, setApiResult] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('ona_token')
    const userStr = localStorage.getItem('ona_user')
    let user: any = null
    try { user = userStr ? JSON.parse(userStr) : null } catch {}

    setInfo(
      `Token in localStorage: ${token ? 'YES (' + token.substring(0, 20) + '...)' : 'NO'}\n` +
      `User in localStorage: ${user ? 'YES' : 'NO'}\n` +
      `User ID: ${user?.id ?? 'N/A'}\n` +
      `Username: ${user?.username ?? 'N/A'}\n` +
      `Onboarding done: ${user?.onboardingDone ?? 'N/A'}\n` +
      `API URL: ${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'}`
    )
  }, [])

  async function testApi() {
    setLoading(true)
    const token = localStorage.getItem('ona_token')
    const userStr = localStorage.getItem('ona_user')
    let user: any = null
    try { user = userStr ? JSON.parse(userStr) : null } catch {}

    if (!token || !user?.id) {
      setApiResult('Cannot test: no token or user in localStorage')
      setLoading(false)
      return
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

    try {
      const res = await fetch(`${apiUrl}/advisor/${user.id}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ question: 'Como lo estoy haciendo?' }),
      })
      const body = await res.text()
      setApiResult(`Status: ${res.status}\nBody: ${body}`)
    } catch (err: any) {
      setApiResult(`Fetch error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream px-5 py-10 lg:px-12">
      <div className="mx-auto max-w-[700px]">
        <h1 className={`${DISPLAY_UI} text-[24px] leading-tight text-ink`}>Debug: Auth & Advisor</h1>
        <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-border-soft bg-paper p-4 font-mono text-[13px] text-ink">
          {info}
        </pre>
        <button
          onClick={testApi}
          disabled={loading}
          className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-ink px-6 text-[15px] font-medium text-cream transition-colors hover:bg-ink-mid disabled:opacity-50"
        >
          {loading ? 'Testing...' : 'Test Advisor API'}
        </button>
        {apiResult && (
          <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-border-soft bg-cream-deep p-4 font-mono text-[13px] text-ink">
            {apiResult}
          </pre>
        )}
      </div>
    </div>
  )
}
