const MAX_DIMENSION = 1920
const JPEG_QUALITY = 0.85

/**
 * Downscale an image file using Canvas API.
 * Returns a new File with the same name but resized to max 1920px on longest side.
 * Non-image files are returned as-is.
 */
export async function downscaleImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      const { width, height } = img

      // Skip if already small enough
      if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
        resolve(file)
        return
      }

      const scale = MAX_DIMENSION / Math.max(width, height)
      const newW = Math.round(width * scale)
      const newH = Math.round(height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = newW
      canvas.height = newH

      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, newW, newH)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file)
            return
          }
          // Keep original filename but ensure .jpg extension for compressed files
          const name = file.name.replace(/\.[^.]+$/, '.jpg')
          resolve(new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }))
        },
        'image/jpeg',
        JPEG_QUALITY
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file) // fallback to original
    }

    img.src = url
  })
}

/**
 * Process multiple files: downscale all images in parallel.
 */
export async function downscaleImages(files: File[]): Promise<File[]> {
  return Promise.all(files.map(downscaleImage))
}

/**
 * Filter to only image files.
 */
export function filterImageFiles(files: File[]): File[] {
  return files.filter(
    (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(f.name)
  )
}
