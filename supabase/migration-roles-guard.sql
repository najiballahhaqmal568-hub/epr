-- قفل سرور برای نقش‌ها — یک بار در Supabase → SQL Editor اجرا کنید.
-- ۱) حساب «شریک (فقط مشاهده)» در سرور هم فقط می‌تواند بخواند؛ نوشتن فقط برای مالک و کارمند.
-- ۲) کسی که تازه حساب ساخته، فقط می‌تواند مالکِ دکانِ تازهٔ خودش شود؛ نمی‌تواند خود را به دکان دیگران بچسپاند.
-- هیچ دیتایی تغییر نمی‌کند؛ فقط قانون‌های دسترسی عوض می‌شوند. دوباره اجرا کردنش بی‌خطر است.

create or replace function shop_has_members(target_shop uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where shop_id = target_shop) $$;

drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert to authenticated
  with check (
    (user_id = auth.uid() and not has_profile() and role = 'owner' and not shop_has_members(shop_id))
    or (my_role() = 'owner' and shop_id = my_shop())
  );

do $$
declare t text;
begin
  foreach t in array array[
    'products','variants','customers','suppliers','sales','purchases','payments',
    'expense_categories','expenses','cash_movements','reconciliations','adjustments','returns'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_rls', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for select to authenticated using (shop_id = my_shop() and generation = shop_generation(shop_id))', t || '_read', t);
    execute format($f$create policy %I on %I for insert to authenticated with check (shop_id = my_shop() and generation = shop_generation(shop_id) and my_role() in ('owner', 'staff'))$f$, t || '_insert', t);
    execute format($f$create policy %I on %I for update to authenticated using (shop_id = my_shop() and generation = shop_generation(shop_id) and my_role() in ('owner', 'staff')) with check (shop_id = my_shop() and generation = shop_generation(shop_id) and my_role() in ('owner', 'staff'))$f$, t || '_update', t);
    execute format($f$create policy %I on %I for delete to authenticated using (shop_id = my_shop() and generation = shop_generation(shop_id) and my_role() in ('owner', 'staff'))$f$, t || '_delete', t);
  end loop;
end $$;
