-- افزودن نقش «شریک (فقط مشاهده)» به دیتابیس موجود
-- این را یک بار در Supabase → SQL Editor اجرا کنید تا حساب شریک ساخته شود.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner', 'staff', 'viewer'));
