'use client'

import { useState, useEffect } from 'react'

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
    <div style={{ padding: 40, fontFamily: 'monospace', maxWidth: 700 }}>
      <h1 style={{ fontSize: 24 }}>Debug: Auth & Advisor</h1>
      <pre style={{ marginTop: 16, padding: 16, background: '#f0f0f0', whiteSpace: 'pre-wrap' }}>
        {info}
      </pre>
      <button
        onClick={testApi}
        disabled={loading}
        style={{ marginTop: 16, padding: '10px 24px', fontSize: 16, background: '#2D6A4F', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}
      >
        {loading ? 'Testing...' : 'Test Advisor API'}
      </button>
      {apiResult && (
        <pre style={{ marginTop: 16, padding: 16, background: '#e8f4f0', whiteSpace: 'pre-wrap' }}>
          {apiResult}
        </pre>
      )}
    </div>
  )
}
