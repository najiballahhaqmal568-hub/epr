-- Run once on an existing Shoe ERP Supabase project.
-- Adds safe authoritative restores without changing current generation-0 data.

alter table shops add column if not exists restore_generation bigint not null default 0;

create or replace function shop_generation(target_shop uuid) returns bigint
language sql stable security definer set search_path = public as
$$ select restore_generation from shops where id = target_shop $$;

do $$
declare t text;
begin
  foreach t in array array[
    'products','variants','customers','suppliers','sales','purchases','payments',
    'expense_categories','expenses','cash_movements','reconciliations','adjustments','returns'
  ] loop
    execute format('alter table %I add column if not exists generation bigint not null default 0', t);
    execute format('drop policy if exists %I on %I', t || '_rls', t);
    execute format(
      'create policy %I on %I for all to authenticated using (shop_id = my_shop() and generation = shop_generation(shop_id)) with check (shop_id = my_shop() and generation = shop_generation(shop_id))',
      t || '_rls', t
    );
  end loop;
end $$;

create or replace function begin_shop_restore() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  owner_shop uuid;
  next_generation bigint;
  t text;
begin
  select shop_id into owner_shop
  from profiles
  where user_id = auth.uid() and role = 'owner';

  if owner_shop is null then
    raise exception 'Only the shop owner can replace cloud data';
  end if;

  update shops
  set restore_generation = restore_generation + 1
  where id = owner_shop
  returning restore_generation into next_generation;

  foreach t in array array[
    'products','variants','customers','suppliers','sales','purchases','payments',
    'expense_categories','expenses','cash_movements','reconciliations','adjustments','returns'
  ] loop
    execute format('delete from %I where shop_id = $1', t) using owner_shop;
  end loop;

  return next_generation;
end $$;

revoke all on function begin_shop_restore() from public;
grant execute on function begin_shop_restore() to authenticated;
