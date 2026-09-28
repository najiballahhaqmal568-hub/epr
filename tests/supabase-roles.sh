#!/usr/bin/env bash
# Server role guard on a real local Postgres with a minimal Supabase stand-in (auth.uid(), authenticated role).
# Usage: bash tests/supabase-roles.sh   (needs a running local Postgres reachable as the postgres user)
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="env PGOPTIONS=-cclient_min_messages=warning psql -X -q -v ON_ERROR_STOP=1"
run() { su postgres -c "$PSQL -d $1" ; }
stub=$(cat <<'SQL'
do $$ begin if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; create role anon nologin; end if; end $$;
create schema auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
grant usage on schema public to authenticated, anon;
alter default privileges in schema public grant all on tables to authenticated;
SQL
)
checks=$(cat <<'SQL'
\set ON_ERROR_STOP 1
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c'),('00000000-0000-0000-0000-00000000000d'),('00000000-0000-0000-0000-00000000000e');
create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
set role authenticated;
-- owner registers a shop (a)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into shops (id, name) values ('11111111-1111-1111-1111-111111111111', 'اتل');
insert into profiles (user_id, shop_id, role, name) values ('00000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'owner', 'مالک');
-- owner adds staff (b) and viewer (c)
insert into profiles (user_id, shop_id, role, name) values ('00000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'staff', 'کارمند');
insert into profiles (user_id, shop_id, role, name) values ('00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'viewer', 'شریک');
insert into sales (uuid, shop_id, data) values ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', '{"total":900}');
-- staff writes
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into sales (uuid, shop_id, data) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', '{"total":800}');
update sales set data = '{"total":801}' where uuid = '22222222-2222-2222-2222-222222222222';
do $$ begin if (select data->>'total' from sales where uuid = '22222222-2222-2222-2222-222222222222') <> '801' then raise exception 'FAIL staff update'; end if; end $$;
-- viewer reads but cannot write
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin if (select count(*) from sales) <> 2 then raise exception 'FAIL viewer read'; end if; end $$;
do $$ begin
  begin insert into sales (uuid, shop_id, data) values (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '{"total":1}'); raise exception 'FAIL viewer insert allowed';
  exception when insufficient_privilege then null; end;
end $$;
update sales set data = '{"total":0}';
delete from sales;
do $$ begin if (select count(*) from sales where data->>'total' in ('900','801')) <> 2 then raise exception 'FAIL viewer changed rows'; end if; end $$;
-- a stranger (d) cannot attach to the shop, neither as owner nor staff
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ begin
  begin insert into profiles (user_id, shop_id, role, name) values ('00000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'owner', 'x'); raise exception 'FAIL stranger joined as owner';
  exception when insufficient_privilege then null; end;
  begin insert into profiles (user_id, shop_id, role, name) values ('00000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'staff', 'x'); raise exception 'FAIL stranger joined as staff';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin if (select count(*) from sales) <> 0 then raise exception 'FAIL stranger sees sales'; end if; end $$;
-- ... but can still register a brand-new shop of their own
insert into shops (id, name) values ('33333333-3333-3333-3333-333333333333', 'دکان دیگر');
insert into profiles (user_id, shop_id, role, name) values ('00000000-0000-0000-0000-00000000000d', '33333333-3333-3333-3333-333333333333', 'owner', 'مالک دوم');
-- a new sign-up (e) cannot make itself staff of its own empty shop either — only owner
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
insert into shops (id, name) values ('44444444-4444-4444-4444-444444444444', 'خالی');
do $$ begin
  begin insert into profiles (user_id, shop_id, role, name) values ('00000000-0000-0000-0000-00000000000e', '44444444-4444-4444-4444-444444444444', 'viewer', 'x'); raise exception 'FAIL self viewer';
  exception when insufficient_privilege then null; end;
end $$;
select 'PASS';
SQL
)
fresh() { su postgres -c "dropdb --if-exists rolestest && createdb rolestest"; echo "$stub" | run rolestest; }
# A) existing project: old schema + old restore-generation + atomic restore, then the migration (twice — must be re-runnable)
fresh
git show HEAD:supabase/schema.sql | run rolestest
git show HEAD:supabase/restore-generation.sql | run rolestest
run rolestest < supabase/atomic-restore.sql
run rolestest < supabase/migration-roles-guard.sql
run rolestest < supabase/migration-roles-guard.sql
echo "$checks" | run rolestest | grep -q PASS && echo 'PASS A: existing project after migration'
# B) new project from the updated schema, and re-running restore-generation must not reopen writes for viewers
fresh
run rolestest < supabase/schema.sql
run rolestest < supabase/restore-generation.sql
run rolestest < supabase/atomic-restore.sql
echo "$checks" | run rolestest | grep -q PASS && echo 'PASS B: fresh schema + re-run restore-generation'
# C) proof the check can go red: the old policies let the viewer write
fresh
git show HEAD:supabase/schema.sql | run rolestest
out=$(echo "$checks" | run rolestest 2>&1 || true); echo "$out" | tail -3 >&2
if echo "$out" | grep -q 'FAIL viewer insert allowed'; then echo 'PASS C: old policies caught (viewer could write)'; else echo 'FAIL C: old policies not caught'; exit 1; fi
