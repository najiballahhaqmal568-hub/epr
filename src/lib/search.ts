import { toLatinDigits } from './format'

/**
 * جستجوی جنس در همهٔ فورم‌ها (میز فروش، گدام، خرید، تبادله، مرجوعی، اصلاح قیمت).
 *
 * پیش از این هر کلمه باید عیناً در نام می‌بود: «go pu» نام «Go pu» را پیدا نمی‌کرد، «gopu» هم نه، و یک
 * حرف اشتباه یا «ي» عربی به جای «ی» فارسی هیچ نتیجه نمی‌داد. حالا:
 * - بزرگ/کوچک لاتین، ی/ي، ک/ك، ه/ة، ارقام فارسی و نیم‌فاصله یکی حساب می‌شوند؛
 * - فاصله مهم نیست («gopu» = «Go pu»)؛
 * - یک حرف اشتباه در کلمهٔ چهار حرفی یا درازتر بخشیده می‌شود (دو حرف در هفت حرفی)؛
 * - نتیجه‌ها مرتب اند: درست‌ترین اول، حدسی‌ها آخر.
 */

export function normalizeSearch(s: string): string {
  return toLatinDigits(s)
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةۀ]/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ً-ٰٟـ‌‍‎‏]/g, '') // اعراب، کشیده، نیم‌فاصله
    .replace(/[-_.,،/\\()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** فاصلهٔ ویرایش، با سقف — اگر از max بیشتر شود زود برمی‌گردد */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, row[j])
    }
    if (best > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

const allowedTypos = (word: string) => (word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0)

/** امتیاز یک کلمه: ۳ عیناً، ۲ بدون فاصله، ۱ با یک حرف اشتباه، ۰ پیدا نشد */
function wordScore(word: string, hay: string, compact: string, tokens: string[]): number {
  if (hay.includes(word)) return 3
  if (compact.includes(word)) return 2
  const typos = allowedTypos(word)
  if (!typos || /\d/.test(word)) return 0 // سایز و کود عیناً: «41» نباید «40» را بگیرد
  // اول کلمهٔ نام هم قبول است: «بهار» با یک غلط باید «بهاری» را هم بگیرد
  for (const t of tokens) {
    if (editDistance(word, t, typos) <= typos) return 1
    if (t.length > word.length && editDistance(word, t.slice(0, word.length), typos) <= typos) return 1
  }
  return 0
}

/** ۰ یعنی پیدا نشد؛ هر چه بیشتر، نزدیک‌تر */
export function searchScore(query: string, hay: string): number {
  const words = normalizeSearch(query).split(' ').filter(Boolean)
  if (!words.length) return 0
  const h = normalizeSearch(hay)
  const compact = h.replace(/ /g, '')
  const tokens = h.split(' ')
  let total = 0
  for (const w of words) {
    const s = wordScore(w, h, compact, tokens)
    if (!s) return 0
    total += s
  }
  // نامی که با همان چیزی شروع می‌شود که نوشته شد، بالاتر
  return total + (compact.startsWith(words.join('')) ? 1 : 0)
}

/** فیلتر و مرتب: hayOf برای ردیفی که نباید آمد null بدهد */
export function bestMatches<T>(items: T[], query: string, hayOf: (item: T) => string | null, limit = 12): T[] {
  if (!query.trim()) return []
  const scored: { item: T; score: number; i: number }[] = []
  items.forEach((item, i) => {
    const hay = hayOf(item)
    if (hay === null) return
    const score = searchScore(query, hay)
    if (score > 0) scored.push({ item, score, i })
  })
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((s) => s.item)
}
