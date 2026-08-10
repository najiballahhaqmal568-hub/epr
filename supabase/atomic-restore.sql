-- Atomic, staged backup restore.
-- Run once in the Supabase SQL editor after schema.sql / restore-generation.sql.

create table if not exists restore_batches (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  expected_counts jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'committed')),
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table if not exists restore_staging (
  batch_id uuid not null references restore_batches on delete cascade,
  shop_id uuid not null references shops on delete cascade,
  table_name text not null check (table_name in (
    'products','variants','customers','suppliers','sales','purchases','payments',
    'expense_categories','expenses','cash_movements','reconciliations','adjustments','returns'
  )),
  uuid uuid not null,
  device_id text not null,
  deleted boolean not null default false,
  data jsonb not null,
  primary key (batch_id, table_name, uuid)
);

create index if not exists restore_batches_owner_idx on restore_batches (owner_id, status, created_at);
create index if not exists restore_staging_batch_idx on restore_staging (batch_id, table_name);

alter table restore_batches enable row level security;
alter table restore_staging enable row level security;

drop policy if exists restore_batches_select on restore_batches;
create policy restore_batches_select on restore_batches for select to authenticated
  using (owner_id = auth.uid() and shop_id = my_shop());

create or replace function can_stage_restore(target_batch uuid, target_shop uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from restore_batches b
    join profiles p on p.user_id = auth.uid()
    where b.id = target_batch
      and b.shop_id = target_shop
      and b.owner_id = auth.uid()
      and b.status = 'pending'
      and p.shop_id = b.shop_id
      and p.role = 'owner'
  )
$$;

drop policy if exists restore_staging_insert on restore_staging;
create policy restore_staging_insert on restore_staging for insert to authenticated
  with check (can_stage_restore(batch_id, shop_id));

revoke all on restore_batches, restore_staging from anon;
revoke all on restore_batches, restore_staging from authenticated;
grant select on restore_batches to authenticated;
grant insert on restore_staging to authenticated;

create or replace function begin_shop_restore_batch(requested_counts jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  owner_shop uuid;
  new_batch uuid;
  table_name text;
  requested_count bigint;
  allowed_tables constant text[] := array[
    'products','variants','customers','suppliers','sales','purchases','payments',
    'expense_categories','expenses','cash_movements','reconciliations','adjustments','returns'
  ];
begin
  select shop_id into owner_shop
  from profiles
  where user_id = auth.uid() and role = 'owner';

  if owner_shop is null then
    raise exception 'Only the shop owner can replace cloud data';
  end if;
  if requested_counts is null or jsonb_typeof(requested_counts) <> 'object' then
    raise exception 'Restore counts must be a JSON object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(requested_counts) as key
    where not (key = any(allowed_tables))
  ) then
    raise exception 'Restore counts contain an unknown table';
  end if;

  foreach table_name in array allowed_tables loop
    if not (requested_counts ? table_name)
       or jsonb_typeof(requested_counts -> table_name) <> 'number' then
      raise exception 'Missing restore count for %', table_name;
    end if;
    begin
      requested_count := (requested_counts ->> table_name)::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Invalid restore count for %', table_name;
    end;
    if requested_count < 0 then
      raise exception 'Negative restore count for %', table_name;
    end if;
  end loop;

  -- A new attempt safely cancels abandoned staging from this same owner. It
  -- never touches any live data table or the active restore generation.
  delete from restore_batches where owner_id = auth.uid() and status = 'pending';

  insert into restore_batches (shop_id, owner_id, expected_counts)
  values (owner_shop, auth.uid(), requested_counts)
  returning id into new_batch;

  return new_batch;
end $$;

create or replace function abort_shop_restore_batch(target_batch uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  removed_count bigint;
begin
  delete from restore_batches b
  using profiles p
  where b.id = target_batch
    and b.status = 'pending'
    and b.owner_id = auth.uid()
    and p.user_id = auth.uid()
    and p.role = 'owner'
    and p.shop_id = b.shop_id;
  get diagnostics removed_count = row_count;
  return removed_count > 0;
end $$;

create or replace function commit_shop_restore_batch(target_batch uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  owner_shop uuid;
  expected_counts jsonb;
  next_generation bigint;
  target_table text;
  expected_count bigint;
  actual_count bigint;
  allowed_tables constant text[] := array[
    'products','variants','customers','suppliers','sales','purchases','payments',
    'expense_categories','expenses','cash_movements','reconciliations','adjustments','returns'
  ];
begin
  select b.shop_id, b.expected_counts
  into owner_shop, expected_counts
  from restore_batches b
  join profiles p on p.user_id = auth.uid()
  where b.id = target_batch
    and b.owner_id = auth.uid()
    and b.status = 'pending'
    and p.shop_id = b.shop_id
    and p.role = 'owner'
  for update of b;

  if owner_shop is null then
    raise exception 'Pending restore batch was not found';
  end if;

  foreach target_table in array allowed_tables loop
    expected_count := (expected_counts ->> target_table)::bigint;
    select count(*) into actual_count
    from restore_staging s
    where s.batch_id = target_batch
      and s.shop_id = owner_shop
      and s.table_name = target_table;
    if actual_count <> expected_count then
      raise exception 'Restore table % is incomplete: expected %, received %',
        target_table, expected_count, actual_count;
    end if;
  end loop;

  -- Everything below is one PostgreSQL transaction. Other devices see either
  -- the complete old generation or the complete new one, never an empty or
  -- partly uploaded shop.
  update shops
  set restore_generation = restore_generation + 1
  where id = owner_shop
  returning restore_generation into next_generation;

  foreach target_table in array allowed_tables loop
    execute format('delete from %I where shop_id = $1', target_table) using owner_shop;
    execute format(
      'insert into %I (uuid, shop_id, generation, device_id, deleted, data) '
      'select uuid, shop_id, $2, device_id, deleted, data '
      'from restore_staging where batch_id = $1 and table_name = $3',
      target_table
    ) using target_batch, next_generation, target_table;
  end loop;

  delete from restore_staging where batch_id = target_batch;
  update restore_batches
  set status = 'committed', committed_at = now()
  where id = target_batch;

  return next_generation;
end $$;

revoke all on function can_stage_restore(uuid, uuid) from public;
revoke all on function begin_shop_restore_batch(jsonb) from public;
revoke all on function abort_shop_restore_batch(uuid) from public;
revoke all on function commit_shop_restore_batch(uuid) from public;
grant execute on function can_stage_restore(uuid, uuid) to authenticated;
grant execute on function begin_shop_restore_batch(jsonb) to authenticated;
grant execute on function abort_shop_restore_batch(uuid) to authenticated;
grant execute on function commit_shop_restore_batch(uuid) to authenticated;
