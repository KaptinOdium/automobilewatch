-- Run once after supabase.sql. The register is provisioned through the admin
-- connection; sign-in roles have no write privileges on this table.
begin;

create table public.supplier_screening_registers (
  owner_id uuid primary key references public.supplier_members(user_id) on delete cascade,
  register jsonb not null check (jsonb_typeof(register) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.supplier_screening_registers enable row level security;
revoke all on public.supplier_screening_registers from public, anon, authenticated;
grant select on public.supplier_screening_registers to authenticated;
create policy supplier_screening_register_owner
  on public.supplier_screening_registers for select to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.supplier_members m
      where m.user_id = (select auth.uid()) and m.active and m.role = 'owner'
    )
  );

commit;
