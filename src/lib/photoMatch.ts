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

/**
 * MediaPipe عکس را از راه WebGL به مدل می‌دهد. گوشی‌ای که WebGL ندارد (یا WebGL آن خاموش است) مدل را باز می‌کند
 * ولی هیچ عکسی را نمی‌خواند — همان «ابزار شناختن عکس باز نشد» که در گوشی دکان دیده شد. آن‌جا روش ساده‌تر
 * به کار می‌رود: رنگ‌ها و شکل کلی کفش، فقط با canvas دوبعدی که در همهٔ گوشی‌ها هست.
 */
export type PhotoMethod = 'model' | 'basic'

interface Reader {
  method: PhotoMethod
  read: (img: HTMLImageElement | HTMLCanvasElement) => Float32Array
}

const SIDE = 64

function pixelsOf(img: HTMLImageElement | HTMLCanvasElement): Uint8ClampedArray {
  const canvas = document.createElement('canvas')
  canvas.width = SIDE
  canvas.height = SIDE
  const g = canvas.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('canvas دوبعدی باز نشد')
  g.drawImage(img, 0, 0, SIDE, SIDE)
  return g.getImageData(0, 0, SIDE, SIDE).data
}

function normalize(v: Float32Array): Float32Array {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

const HUES = 12
const GRAYS = 4
const CELLS = 4
const ORIENTATIONS = 8

/** رنگ (۱۲ رنگ + ۴ خاکستری، وسط عکس وزن بیشتر) و شکل (جهت لبه‌ها در ۴×۴ خانه) */
export function basicVector(img: HTMLImageElement | HTMLCanvasElement): Float32Array {
  const px = pixelsOf(img)
  const colour = new Float32Array(HUES + GRAYS)
  const gray = new Float32Array(SIDE * SIDE)
  const mid = (SIDE - 1) / 2
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const i = (y * SIDE + x) * 4
      const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255
      gray[y * SIDE + x] = 0.299 * r + 0.587 * g + 0.114 * b
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const sat = max ? (max - min) / max : 0
      const weight = Math.exp(-((x - mid) ** 2 + (y - mid) ** 2) / (2 * (SIDE / 3) ** 2))
      if (sat < 0.2 || max < 0.15) {
        colour[HUES + Math.min(GRAYS - 1, Math.floor(max * GRAYS))] += weight
      } else {
        const d = max - min
        let hue = max === r ? (g - b) / d : max === g ? 2 + (b - r) / d : 4 + (r - g) / d
        hue = ((hue / 6) % 1 + 1) % 1
        colour[Math.min(HUES - 1, Math.floor(hue * HUES))] += weight
      }
    }
  }
  const shape = new Float32Array(CELLS * CELLS * ORIENTATIONS)
  const cell = SIDE / CELLS
  for (let y = 1; y < SIDE - 1; y++) {
    for (let x = 1; x < SIDE - 1; x++) {
      const at = (dx: number, dy: number) => gray[(y + dy) * SIDE + x + dx]
      const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1)
      const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1)
      const magnitude = Math.hypot(gx, gy)
      if (!magnitude) continue
      const angle = (Math.atan2(gy, gx) + Math.PI) % Math.PI // جهت لبه، بی‌علامت
      const bin = Math.min(ORIENTATIONS - 1, Math.floor((angle / Math.PI) * ORIENTATIONS))
      shape[(Math.floor(y / cell) * CELLS + Math.floor(x / cell)) * ORIENTATIONS + bin] += magnitude
    }
  }
  // ریشهٔ دوم: یک رنگ یا لبهٔ بزرگ همه‌چیز را نپوشاند
  const root = (v: Float32Array) => normalize(v.map(Math.sqrt))
  const c = root(colour), s = root(shape)
  const out = new Float32Array(c.length + s.length)
  out.set(c.map((x) => x * 0.6), 0)
  out.set(s.map((x) => x * 0.8), c.length)
  return normalize(out)
}

const basicReader: Reader = { method: 'basic', read: basicVector }

function modelReader(model: ImageEmbedder): Reader {
  return {
    method: 'model',
    read: (img) => {
      const values = model.embed(img).embeddings[0]?.floatEmbedding
      if (!values?.length) throw new Error('عکس خوانده نشد')
      return Float32Array.from(values)
    }
  }
}

let reader: Promise<Reader> | null = null

/** مدل اگر باز شود و یک عکس آزمایشی را بخواند؛ ورنه روش ساده. */
function loadReader(): Promise<Reader> {
  reader ??= (async () => {
    let model: ImageEmbedder
    try {
      model = await loadEmbedder()
    } catch (error) {
      console.warn('photo model did not load', error)
      reader = null // فایل‌ها شاید بار بعد برسند
      return basicReader
    }
    const probe = document.createElement('canvas')
    probe.width = 16
    probe.height = 16
    probe.getContext('2d')?.fillRect(0, 0, 8, 8)
    try {
      modelReader(model).read(probe)
      return modelReader(model)
    } catch (error) {
      console.warn('photo model cannot read images on this phone', error)
      return basicReader // بی WebGL: در این گوشی همیشه همین می‌ماند
    }
  })()
  return reader
}

async function vectorOf(r: Reader, src: string): Promise<Float32Array> {
  return r.read(await loadImage(src))
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
  /** basic یعنی این گوشی مدل را نتوانست به کار ببرد و با رنگ و شکل مقایسه شد */
  method: PhotoMethod
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
  const r = await loadReader()
  const query = await vectorOf(r, shot)
  const cached = new Map((await db.photoIndex.bulkGet(withPhoto.map((p) => p.id!))).filter(Boolean).map((row) => [row!.productId, row!]))
  const matches: PhotoMatch[] = []
  let done = 0
  for (const p of withPhoto) {
    // بردار مدل و بردار ساده با هم مقایسه نمی‌شوند؛ نشان روش جزء نشانی عکس است
    const hash = r.method === 'model' ? photoHash(p.photo!) : `basic|${photoHash(p.photo!)}`
    let vector = cached.get(p.id!)?.photoHash === hash ? cached.get(p.id!)!.vector : undefined
    if (!vector) {
      try {
        vector = await vectorOf(r, p.photo!)
        await db.photoIndex.put({ productId: p.id!, photoHash: hash, vector })
      } catch {
        vector = undefined // عکس خراب یک بوت جستجوی بقیه را متوقف نمی‌کند
      }
    }
    if (vector) matches.push({ productId: p.id!, score: similarity(query, vector) })
    onProgress?.(++done, withPhoto.length)
  }
  matches.sort((a, b) => b.score - a.score)
  return { matches: matches.slice(0, limit), withoutPhoto: products.length - withPhoto.length, method: r.method }
}
