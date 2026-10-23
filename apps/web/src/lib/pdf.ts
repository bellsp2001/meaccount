import api from './api'

/**
 * Fetch a document PDF through the authenticated API client (the preview
 * endpoints require a Bearer token, so we can't just point window.open at the
 * URL) and open it in a new tab as a blob URL.
 */
export async function openDocPdf(url: string): Promise<void> {
  const { data } = await api.get(url, { responseType: 'blob' })
  const blobUrl = URL.createObjectURL(data as Blob)
  window.open(blobUrl, '_blank')
  // Give the new tab time to load before releasing the object URL.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
}
