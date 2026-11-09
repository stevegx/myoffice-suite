import { useRef, useState } from 'react'

export function useTask() {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<{ title: string; detail: string }>()
  const running = useRef(false)

  async function run(loading: string, failure: string, action: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setBusy(loading)
    setError(undefined)
    try {
      await action()
    } catch (cause) {
      setError({ title: failure, detail: cause instanceof Error ? cause.message : 'Δοκίμασε ξανά.' })
    } finally {
      running.current = false
      setBusy('')
    }
  }

  return { busy, error, run, clearError: () => setError(undefined) }
}
