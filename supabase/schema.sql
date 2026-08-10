-- Shoe ERP cloud schema. Paste this whole file into the Supabase SQL editor and press Run.

create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  restore_generation bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id uuid primary key references auth.users on delete cascade,
  shop_id uuid not null references shops on delete cascade,
  role text not null check (role in ('owner', 'staff', 'viewer')),
  name text not null,
  created_at timestamptz not null default now()
);

-- security-definer helpers (bypass RLS to avoid recursive policies)
create or replace function my_shop() returns uuid
language sql stable security definer set search_path = public as
$$ select shop_id from profiles where user_id = auth.uid() $$;

create or replace function my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where user_id = auth.uid() $$;

create or replace function has_profile() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from profiles where user_id = auth.uid()) $$;

create or replace function shop_generation(target_shop uuid) returns bigint
language sql stable security definer set search_path = public as
$$ select restore_generation from shops where id = target_shop $$;

alter table shops enable row level security;
alter table profiles enable row level security;

create policy shops_insert on shops for insert to authenticated with check (true);
create policy shops_select on shops for select to authenticated using (id = my_shop());

create policy profiles_select on profiles for select to authenticated
  using (user_id = auth.uid() or shop_id = my_shop());
create policy profiles_insert on profiles for insert to authenticated
  with check (
    (user_id = auth.uid() and not has_profile())
    or (my_role() = 'owner' and shop_id = my_shop())
  );

create or replace function touch_updated_at() returns trigger
language plpgsql as
$$ begin new.updated_at := now(); return new; end $$;

-- data tables: one per local store, identical shape
do $$
declare t text;
begin
  foreach t in array array[
    'products','variants','customers','suppliers','sales','purchases','payments',
    'expense_categories','expenses','cash_movements','reconciliations','adjustments','returns'
  ] loop
    execute format($f$
      create table if not exists %I (
        uuid uuid primary key,
        shop_id uuid not null references shops on delete cascade,
        generation bigint not null default 0,
        device_id text not null default '',
        deleted boolean not null default false,
        data jsonb not null,
        updated_at timestamptz not null default now()
      )$f$, t);
    execute format('create index if not exists %I on %I (shop_id, updated_at)', t || '_shop_updated_idx', t);
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all to authenticated using (shop_id = my_shop() and generation = shop_generation(shop_id)) with check (shop_id = my_shop() and generation = shop_generation(shop_id))', t || '_rls', t);
    execute format($f$
      create or replace trigger %I before insert or update on %I
      for each row execute function touch_updated_at()$f$, t || '_touch', t);
  end loop;
end $$;

-- Owner-only authoritative restore. The delete and generation bump are one
-- transaction, so other updated devices see the new generation before syncing.
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
