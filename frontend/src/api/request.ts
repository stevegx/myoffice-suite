export class RequestError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

export async function apiRequest<T>(
  path: string, options: RequestInit, read: (response: Response) => Promise<T>,
): Promise<T> {
  const timeout = AbortSignal.timeout(options.method === 'POST' ? 120_000 : 15_000)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  let response: Response | undefined
  try {
    response = await fetch(path, { cache: 'no-store', ...options, signal })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new RequestError(
        typeof error?.detail === 'string' ? error.detail : `Το αίτημα απέτυχε (HTTP ${response.status}).`,
        response.status,
      )
    }
    return await read(response)
  } catch (error) {
    if (options.signal?.aborted) throw error
    if (timeout.aborted) throw new RequestError('Ο διακομιστής άργησε να απαντήσει. Δοκίμασε ξανά.')
    if (error instanceof RequestError) throw error
    throw new RequestError(response
      ? 'Δεν ήταν δυνατή η ανάγνωση της απάντησης του διακομιστή.'
      : 'Δεν ήταν δυνατή η σύνδεση με τον διακομιστή. Έλεγξε τη σύνδεση και δοκίμασε ξανά.')
  }
}

export function jsonOptions(data: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
}

export function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  return apiRequest(path, options, async (response) => response.json())
}
