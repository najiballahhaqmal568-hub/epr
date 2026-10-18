import type { ImageEmbedder } from '@mediapipe/tasks-vision'
import { db, type Product } from '../db'

/**
 * «جستجو با عکس» در میز فروش: عکسی که فروشنده از کفش می‌گیرد با عکس بوت‌های گدام مقایسه می‌شود.
 * همه‌چیز در خود گوشی است — مدل MobileNet v3 (MediaPipe Image Embedder)، بی انترنت و بی هزینه.
 *
 * این ماژول فقط «شبیه‌ترین‌ها» را می‌گوید؛ هیچ‌وقت چیزی را به سبد نمی‌اندازد. دو بوت شبیه با قیمت جدا
 * را عکس گاهی اشتباه می‌گیرد، پس انتخاب آخر همیشه با لمس فروشنده است.
 */

let embedder: Promise<ImageEmbedder> | null = null

function loadEmbedder(): Promise<ImageEmbedder> {
  embedder ??= (async () => {
    const { ImageEmbedder } = await import('@mediapipe/tasks-vision')
    // base './' — همان پوشهٔ اپ، هم در وب (/epr/) و هم در APK
    const base = new URL('vision/', document.baseURI).href
    return ImageEmbedder.createFromOptions(
      { wasmLoaderPath: `${base}vision_wasm_internal.js`, wasmBinaryPath: `${base}vision_wasm_internal.wasm` },
      { baseOptions: { modelAssetPath: `${base}mobilenet_v3_small.tflite`, delegate: 'CPU' }, runningMode: 'IMAGE', l2Normalize: true, quantize: false }
    )
  })().catch((error) => {
    embedder = null // دفعهٔ بعد دوباره کوشش شود (مثلاً انترنت بار اول قطع بود)
    throw error
  })
  return embedder
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('عکس باز نشد'))
    img.src = src
  })
}

async function vectorOf(src: string): Promise<Float32Array> {
  const [model, img] = await Promise.all([loadEmbedder(), loadImage(src)])
  const values = model.embed(img).embeddings[0]?.floatEmbedding
  if (!values?.length) throw new Error('عکس خوانده نشد')
  return Float32Array.from(values)
}

/** FNV-1a — فقط برای فهمیدن اینکه عکس یک بوت عوض شده یا نه */
export function photoHash(photo: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < photo.length; i++) {
    h ^= photo.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${photo.length}:${(h >>> 0).toString(16)}`
}

/** هر دو بردار l2-normalized اند؛ ضرب داخلی همان شباهت کسینوسی است */
function similarity(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i]
  return s
}

export interface PhotoMatch {
  productId: number
  score: number
}

export interface PhotoSearchResult {
  matches: PhotoMatch[]
  /** بوت‌هایی که عکس ندارند — با عکس پیدا نمی‌شوند */
  withoutPhoto: number
}

/**
 * نشانی عکس هر بوت یک بار ساخته و در همین گوشی نگه داشته می‌شود؛ بار بعد فقط بوت‌های نو یا عکس‌های
 * عوض‌شده دوباره خوانده می‌شوند. onProgress(done, total) برای نشان دادن «آماده‌کردن عکس‌های گدام».
 */
export async function findByPhoto(
  shot: string,
  products: Product[],
  onProgress?: (done: number, total: number) => void,
  limit = 3
): Promise<PhotoSearchResult> {
  const withPhoto = products.filter((p) => p.id !== undefined && p.photo)
  const query = await vectorOf(shot)
  const cached = new Map((await db.photoIndex.bulkGet(withPhoto.map((p) => p.id!))).filter(Boolean).map((row) => [row!.productId, row!]))
  const matches: PhotoMatch[] = []
  let done = 0
  for (const p of withPhoto) {
    const hash = photoHash(p.photo!)
    let vector = cached.get(p.id!)?.photoHash === hash ? cached.get(p.id!)!.vector : undefined
    if (!vector) {
      try {
        vector = await vectorOf(p.photo!)
        await db.photoIndex.put({ productId: p.id!, photoHash: hash, vector })
      } catch {
        vector = undefined // عکس خراب یک بوت جستجوی بقیه را متوقف نمی‌کند
      }
    }
    if (vector) matches.push({ productId: p.id!, score: similarity(query, vector) })
    onProgress?.(++done, withPhoto.length)
  }
  matches.sort((a, b) => b.score - a.score)
  return { matches: matches.slice(0, limit), withoutPhoto: products.length - withPhoto.length }
}
