-- Supplier Atlas: run once in a dedicated Supabase project.
-- No user identities are embedded here. Add exactly the two verified Auth user IDs
-- to supplier_members after creating the accounts through an admin connection.

begin;

create table if not exists public.supplier_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'viewer' check (role in ('owner', 'editor', 'viewer')),
  active boolean not null default true
);
alter table public.supplier_members enable row level security;
revoke all on public.supplier_members from public, anon, authenticated;
grant select on public.supplier_members to authenticated;
drop policy if exists supplier_member_self on public.supplier_members;
create policy supplier_member_self on public.supplier_members for select to authenticated
  using (user_id = (select auth.uid()) and active);

create table if not exists public.supplier_datasets (
  id text primary key check (id = 'main'),
  suppliers jsonb not null default '[]'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  constraint supplier_array check (jsonb_typeof(suppliers) = 'array'),
  constraint supplier_row_limit check (jsonb_array_length(suppliers) <= 10000),
  constraint supplier_size_limit check (octet_length(suppliers::text) <= 15000000)
);
insert into public.supplier_datasets(id) values ('main') on conflict (id) do nothing;
alter table public.supplier_datasets enable row level security;
revoke all on public.supplier_datasets from public, anon, authenticated;
grant select on public.supplier_datasets to authenticated;
drop policy if exists supplier_dataset_members on public.supplier_datasets;
create policy supplier_dataset_members on public.supplier_datasets for select to authenticated
  using (exists (select 1 from public.supplier_members m where m.user_id = (select auth.uid()) and m.active));

create or replace function public.save_supplier_dataset(expected_revision integer, supplier_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved public.supplier_datasets;
begin
  if auth.uid() is null or not exists (
    select 1 from public.supplier_members m
    where m.user_id = auth.uid() and m.active and m.role in ('owner', 'editor')
  ) then
    raise exception using errcode = '42501', message = 'This account cannot save the shared supplier list.';
  end if;
  if expected_revision is null or expected_revision < 0 or supplier_rows is null
      or jsonb_typeof(supplier_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'A valid list and saved revision are required.';
  end if;
  if jsonb_array_length(supplier_rows) > 10000 or octet_length(supplier_rows::text) > 15000000 then
    raise exception using errcode = '22023', message = 'The supplier list exceeds the supported size.';
  end if;
  if exists (select 1 from jsonb_array_elements(supplier_rows) r where jsonb_typeof(r) <> 'object') then
    raise exception using errcode = '22023', message = 'Every supplier must be an object.';
  end if;
  update public.supplier_datasets
     set suppliers = supplier_rows, revision = revision + 1,
         updated_at = now(), updated_by = auth.uid()
   where id = 'main' and revision = expected_revision
   returning * into saved;
  if not found then
    raise exception using errcode = '40001', message = 'The shared list changed. Load the latest version before saving.';
  end if;
  return to_jsonb(saved);
end;
$$;
revoke all on function public.save_supplier_dataset(integer, jsonb) from public, anon;
grant execute on function public.save_supplier_dataset(integer, jsonb) to authenticated;

commit;

-- Required activation steps:
-- 1. Disable public signups and anonymous sign-ins in Supabase Auth.
-- 2. Configure Site URL and exact redirect allowlist:
--    https://kaptinodium.github.io/automobilewatch/suppliers/
--    https://kaptinodium.github.io/automobilewatch/suppliers/account.html
--    Set invitation/recovery email links as documented in setup/README.md.
-- 3. Create the two accounts using verified emails. Never put passwords or a
--    service-role key in this repository. Each user sets their own password.
-- 4. Insert their exact Auth UUIDs into supplier_members; owner for the requester,
--    editor/viewer for Tudor according to the chosen collaboration access.
-- 5. Set only the project URL and public publishable/anon key in config.json.
-- 6. Test anonymous denial, non-member denial, member read, editor write,
--    viewer write denial and revision conflict on the deployed database.
