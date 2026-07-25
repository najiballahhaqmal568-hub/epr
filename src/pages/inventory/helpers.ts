export interface VariantForm {
  id?: number
  size: string
  color: string
  purchasePrice: string
  retailPrice: string
  wholesalePrice: string
  stockQty: string
  lowStock: string
  cartonQty: string
}

export const emptyVariant = (): VariantForm => ({
  size: '',
  color: '',
  purchasePrice: '',
  retailPrice: '',
  wholesalePrice: '',
  stockQty: '0',
  lowStock: '2',
  cartonQty: ''
})

export async function downscalePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const max = 800
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.75)
  } finally {
    URL.revokeObjectURL(url)
  }
}
