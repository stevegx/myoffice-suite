import { useEffect, useState } from 'react'

type ApiState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error' }

export function useApi<T>(path: string) {
  const [result, setResult] = useState<ApiState<T>>({ status: 'loading' })
  const [request, setRequest] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch(path, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const data: T = await response.json()
        if (!controller.signal.aborted) setResult({ status: 'ready', data })
      } catch {
        if (!controller.signal.aborted) setResult({ status: 'error' })
      }
    }

    void load()
    return () => controller.abort()
  }, [path, request])

  function reload() {
    setResult({ status: 'loading' })
    setRequest((previous) => previous + 1)
  }

  return [result, reload] as const
}
