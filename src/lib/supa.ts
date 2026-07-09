import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { db, newUuid } from '../db'

let client: SupabaseClient | null = null
let clientKey = ''

export interface ServerConfig {
  url: string
  anonKey: string
}

export async function getServerConfig(): Promise<ServerConfig | null> {
  const url = (await db.settings.get('supaUrl'))?.value as string | undefined
  const anonKey = (await db.settings.get('supaKey'))?.value as string | undefined
  if (!url || !anonKey) return null
  return { url, anonKey }
}

export async function setServerConfig(cfg: ServerConfig): Promise<void> {
  await db.settings.put({ key: 'supaUrl', value: cfg.url.trim().replace(/\/$/, '') })
  await db.settings.put({ key: 'supaKey', value: cfg.anonKey.trim() })
  client = null
}

export async function getSupa(): Promise<SupabaseClient | null> {
  const cfg = await getServerConfig()
  if (!cfg) return null
  const key = cfg.url + cfg.anonKey
  if (!client || clientKey !== key) {
    client = createClient(cfg.url, cfg.anonKey)
    clientKey = key
  }
  return client
}

export interface Profile {
  user_id: string
  shop_id: string
  role: 'owner' | 'staff'
  name: string
}

export async function getProfile(): Promise<Profile | null> {
  const supa = await getSupa()
  if (!supa) return null
  const { data: auth } = await supa.auth.getUser()
  if (!auth.user) return null
  const { data } = await supa.from('profiles').select('*').eq('user_id', auth.user.id).maybeSingle()
  return (data as Profile) ?? null
}

/** ثبت‌نام مالک: حساب + دکان + پروفایل */
export async function registerOwner(email: string, password: string, name: string, shopName: string): Promise<void> {
  const supa = await getSupa()
  if (!supa) throw new Error('سرور تنظیم نشده')
  const { data, error } = await supa.auth.signUp({ email, password })
  if (error) throw error
  const userId = data.user?.id ?? (await supa.auth.getUser()).data.user?.id
  if (!userId) throw new Error('ثبت‌نام ناکام شد — شاید تأیید ایمیل فعال است؛ آن را در Supabase غیرفعال کنید')
  // شناسهٔ دکان را خود کلاینت می‌سازد؛ خواندن ردیف تازه قبل از داشتن پروفایل توسط RLS بسته است
  const shopId = newUuid()
  const { error: shopErr } = await supa.from('shops').insert({ id: shopId, name: shopName })
  if (shopErr) throw shopErr
  const { error: profErr } = await supa.from('profiles').insert({ user_id: userId, shop_id: shopId, role: 'owner', name })
  if (profErr) throw profErr
}

export async function login(email: string, password: string): Promise<void> {
  const supa = await getSupa()
  if (!supa) throw new Error('سرور تنظیم نشده')
  const { error } = await supa.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function logout(): Promise<void> {
  const supa = await getSupa()
  await supa?.auth.signOut()
}

/** ساخت حساب کارمند توسط مالک (با کلاینت موقت تا سشن مالک خراب نشود) */
export async function createStaff(email: string, password: string, name: string): Promise<void> {
  const cfg = await getServerConfig()
  const supa = await getSupa()
  if (!cfg || !supa) throw new Error('سرور تنظیم نشده')
  const profile = await getProfile()
  if (!profile || profile.role !== 'owner') throw new Error('فقط مالک می‌تواند کارمند اضافه کند')
  const temp = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } })
  const { data, error } = await temp.auth.signUp({ email, password })
  if (error) throw error
  const staffId = data.user?.id
  if (!staffId) throw new Error('ساخت حساب ناکام شد')
  const { error: profErr } = await supa.from('profiles').insert({ user_id: staffId, shop_id: profile.shop_id, role: 'staff', name })
  if (profErr) throw profErr
}
