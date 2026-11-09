import { apiRequest, jsonOptions, RequestError } from '../api/request'

function downloadName(disposition: string) {
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch {
      // Use the ASCII filename when the encoded filename is invalid.
    }
  }
  return disposition.match(/filename="([^"]+)"/i)?.[1]
}

export async function downloadFile(path: string, data: object) {
  const { blob, filename } = await apiRequest(path, jsonOptions(data), async (response) => {
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const filename = /^attachment\b/i.test(disposition) && downloadName(disposition)
    if (!filename) throw new RequestError('Ο διακομιστής δεν επέστρεψε αρχείο λήψης.')
    const blob = await response.blob()
    if (!blob.size) throw new RequestError('Το αρχείο που επέστρεψε ο διακομιστής είναι κενό.')
    return { blob, filename }
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
}
