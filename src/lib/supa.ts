import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { db, newUuid } from '../db'

let client: SupabaseClient | null = null
let clientKey = ''

// This is a public browser key, not a secret/service-role key. Keeping the
// shop's default project here lets a new phone or browser show the login page
// immediately instead of silently running with cloud sync disabled.
const DEFAULT_SERVER_CONFIG: ServerConfig = {
  url: 'https://xkvpdeguayorxzvjgpmv.supabase.co',
  anonKey: 'sb_publishable_42m2CI7EWyoXGI1av1pSJA_8jBhbiGT'
}

export interface ServerConfig {
  url: string
  anonKey: string
}

export async function getServerConfig(): Promise<ServerConfig | null> {
  const url = (await db.settings.get('supaUrl'))?.value as string | undefined
  const anonKey = (await db.settings.get('supaKey'))?.value as string | undefined
  if (!url && !anonKey) return DEFAULT_SERVER_CONFIG
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
  role: 'owner' | 'staff' | 'viewer'
  name: string
}

export async function getProfile(): Promise<Profile | null> {
  const supa = await getSupa()
  if (!supa) return null
  const { data: auth, error: authError } = await supa.auth.getUser()
  if (authError) throw authError
  if (!auth.user) return null
  const { data, error } = await supa.from('profiles').select('*').eq('user_id', auth.user.id).maybeSingle()
  if (error) throw error
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

/** The recovery email must return to this deployed app, never to localhost. */
export function passwordRecoveryRedirectUrl(currentHref = window.location.href): string {
  return new URL('.', currentHref).toString()
}

export function isPasswordRecoveryUrl(url = window.location.href): boolean {
  const parsed = new URL(url)
  return parsed.hash.includes('type=recovery') || parsed.searchParams.get('type') === 'recovery'
}

export async function requestPasswordReset(email: string): Promise<void> {
  const supa = await getSupa()
  if (!supa) throw new Error('سرور تنظیم نشده')
  const { error } = await supa.auth.resetPasswordForEmail(email, {
    redirectTo: passwordRecoveryRedirectUrl()
  })
  if (error) throw error
}

export async function finishPasswordRecovery(password: string): Promise<void> {
  const supa = await getSupa()
  if (!supa) throw new Error('سرور تنظیم نشده')
  const { data: session, error: sessionError } = await supa.auth.getSession()
  if (sessionError) throw sessionError
  if (!session.session) throw new Error('لینک بازیابی تمام شده است؛ یک لینک نو درخواست کنید')
  const { error } = await supa.auth.updateUser({ password })
  if (error) throw error
  // Do not start syncing this phone's current local data under a different owner.
  // The owner signs in normally after the password has been changed.
  await supa.auth.signOut()
}

export async function logout(): Promise<void> {
  const supa = await getSupa()
  await supa?.auth.signOut()
}

/** ساخت حساب کارمند/شریک توسط مالک (با کلاینت موقت تا سشن مالک خراب نشود) */
export async function createStaff(email: string, password: string, name: string, role: 'staff' | 'viewer' = 'staff'): Promise<void> {
  const cfg = await getServerConfig()
  const supa = await getSupa()
  if (!cfg || !supa) throw new Error('سرور تنظیم نشده')
  const profile = await getProfile()
  if (!profile || profile.role !== 'owner') throw new Error('فقط مالک می‌تواند حساب اضافه کند')
  const temp = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } })
  const { data, error } = await temp.auth.signUp({ email, password })
  if (error) throw error
  const staffId = data.user?.id
  if (!staffId) throw new Error('ساخت حساب ناکام شد')
  const { error: profErr } = await supa.from('profiles').insert({ user_id: staffId, shop_id: profile.shop_id, role, name })
  if (profErr) throw profErr
}
