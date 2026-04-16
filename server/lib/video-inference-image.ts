import sharp from 'sharp'

function toDataUrl(buffer: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

function normalizeMimeType(mimeType: string | undefined): string {
  const value = String(mimeType || '').trim().toLowerCase()
  return value || 'image/jpeg'
}

/**
 * Create a transient JPEG copy for video inference while preserving the original image.
 * Falls back to the original data URL if optimization fails.
 */
export async function optimizeVideoInferenceImage(
  buffer: Buffer,
  originalMimeType: string,
): Promise<string> {
  const normalizedMimeType = normalizeMimeType(originalMimeType)
  const originalDataUrl = toDataUrl(buffer, normalizedMimeType)

  try {
    const jpegBuffer = await sharp(buffer, { failOn: 'none' })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer()

    return toDataUrl(jpegBuffer, 'image/jpeg')
  } catch {
    return originalDataUrl
  }
}
