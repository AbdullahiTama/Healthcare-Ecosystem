// Shrinks an image in the browser before upload.
// Big phone photos (5–10MB) become small, fast uploads — important on weak networks.
// Returns a Blob. Falls back to the original file if anything goes wrong.
export function resizeImage(file, maxSize = 800, quality = 0.82) {
  return new Promise((resolve) => {
    try {
      if (!file || !file.type?.startsWith('image/')) { resolve(file); return }

      const reader = new FileReader()
      reader.onerror = () => resolve(file)
      reader.onload = () => {
        const img = new Image()
        img.onerror = () => resolve(file)
        img.onload = () => {
          try {
            let { width, height } = img

            // Only shrink — never blow a small image up
            if (width > maxSize || height > maxSize) {
              if (width > height) {
                height = Math.round((height * maxSize) / width)
                width = maxSize
              } else {
                width = Math.round((width * maxSize) / height)
                height = maxSize
              }
            }

            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0, width, height)

            canvas.toBlob(
              (blob) => resolve(blob || file),
              'image/jpeg',
              quality
            )
          } catch (e) {
            resolve(file)
          }
        }
        img.src = reader.result
      }
      reader.readAsDataURL(file)
    } catch (e) {
      resolve(file)
    }
  })
}
