import { useEffect, useState } from 'react'
import { RequestError, requestJson } from './request'

type ApiState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; detail: string; code?: number }

export function useApi<T>(path: string) {
  const [result, setResult] = useState<ApiState<T>>({ status: 'loading' })
  const [request, setRequest] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const data = await requestJson<T>(path, { signal: controller.signal })
        if (!controller.signal.aborted) setResult({ status: 'ready', data })
      } catch (error) {
        if (!controller.signal.aborted) setResult({
          status: 'error',
          detail: error instanceof RequestError ? error.message : 'Δοκίμασε ξανά.',
          code: error instanceof RequestError ? error.status : undefined,
        })
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
