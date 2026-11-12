-- Run as the project database administrator after setup/supabase.sql.
-- No emails, passwords, identities, sessions or real user changes are created.
-- Three random, id-only auth.users fixtures satisfy membership foreign keys.
-- Every test mutation is rolled back in a PL/pgSQL subtransaction, followed by
-- an outer ROLLBACK. Do not replace either rollback mechanism with COMMIT.
-- This verifies PostgreSQL grants/RLS/RPC behavior, not JWT signature validation
-- or the browser/email flow. Run the latter separately with the owner's account.

begin;
set local lock_timeout = '2s';
set local statement_timeout = '20s';

do $verification$
declare
  admin_role text := current_user;
  owner_id uuid := gen_random_uuid();
  editor_id uuid := gen_random_uuid();
  viewer_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  baseline jsonb;
  saved jsonb;
  initial_revision integer;
  fixtures jsonb := '[{"name":"Synthetic verification supplier","duns":"TEST-ONLY","country":"Czechia","city":"Prague"}]'::jsonb;
  checks jsonb := '[]'::jsonb;
  table_name text;
  privilege_name text;
  subject uuid;
begin
  if admin_role in ('anon', 'authenticated') then
    raise exception 'Run verification with the database administrator role.';
  end if;
  if exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal) then
    raise exception 'Auth has custom triggers. Review their effects before using id-only test fixtures.';
  end if;
  if (select count(*) from public.supplier_datasets) <> 1 then
    raise exception 'Expected exactly the main supplier dataset.';
  end if;
  select to_jsonb(d), d.revision into baseline, initial_revision
    from public.supplier_datasets d where d.id = 'main' for update;
  if baseline is null or initial_revision > 2147483645 then
    raise exception 'Dataset is missing or revision cannot safely be incremented for testing.';
  end if;

  foreach table_name in array array['public.supplier_members', 'public.supplier_datasets'] loop
    if not (select relrowsecurity from pg_class where oid = table_name::regclass) then
      raise exception 'RLS is disabled on %.', table_name;
    end if;
    if not has_table_privilege('authenticated', table_name, 'SELECT') then
      raise exception 'Authenticated SELECT grant is missing on %.', table_name;
    end if;
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('anon', table_name, privilege_name) then
        raise exception 'Anonymous role unexpectedly has % on %.', privilege_name, table_name;
      end if;
      if privilege_name <> 'SELECT' and has_table_privilege('authenticated', table_name, privilege_name) then
        raise exception 'Authenticated role unexpectedly has direct % on %.', privilege_name, table_name;
      end if;
    end loop;
  end loop;
  if to_regclass('public.supplier_activation_claims') is not null then
    if not (select relrowsecurity from pg_class where oid = 'public.supplier_activation_claims'::regclass) then
      raise exception 'RLS is disabled on supplier_activation_claims.';
    end if;
    foreach privilege_name in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('anon', 'public.supplier_activation_claims', privilege_name)
         or has_table_privilege('authenticated', 'public.supplier_activation_claims', privilege_name) then
        raise exception 'Client role unexpectedly has % on supplier_activation_claims.', privilege_name;
      end if;
    end loop;
    checks := checks || '"activation claims inaccessible to client roles"'::jsonb;
  end if;
  if (select prosecdef from pg_proc where oid = 'public.save_supplier_dataset(integer,jsonb)'::regprocedure)
     or not (select prosecdef from pg_proc where oid = 'supplier_private.save_supplier_dataset(integer,jsonb)'::regprocedure) then
    raise exception 'Expected public invoker wrapper and private definer implementation.';
  end if;
  foreach table_name in array array['public.save_supplier_dataset(integer,jsonb)', 'supplier_private.save_supplier_dataset(integer,jsonb)'] loop
    if has_function_privilege('anon', table_name, 'EXECUTE')
       or not has_function_privilege('authenticated', table_name, 'EXECUTE') then
      raise exception 'Unexpected execute grants on %.', table_name;
    end if;
    if not exists (select 1 from pg_proc p, unnest(p.proconfig) as config_entry(setting)
      where p.oid = table_name::regprocedure and setting in ('search_path=""', 'search_path=')) then
      raise exception 'Empty search_path is not pinned on %.', table_name;
    end if;
  end loop;
  if has_schema_privilege('anon', 'supplier_private', 'USAGE')
     or has_schema_privilege('authenticated', 'supplier_private', 'CREATE')
     or not has_schema_privilege('authenticated', 'supplier_private', 'USAGE') then
    raise exception 'Unexpected private-schema privileges.';
  end if;
  checks := checks || '"grants, RLS flags, wrapper and definer configuration"'::jsonb;

  -- All fixtures and dataset writes live only in this exception subtransaction.
  begin
    insert into auth.users(id) values (owner_id), (editor_id), (viewer_id);
    insert into public.supplier_members(user_id, display_name, role, active) values
      (owner_id, 'Rollback-only owner', 'owner', true),
      (editor_id, 'Rollback-only editor', 'editor', true),
      (viewer_id, 'Rollback-only viewer', 'viewer', true);

    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
    begin
      perform 1 from public.supplier_datasets;
      raise exception 'FAIL: anonymous dataset read succeeded.';
    exception when insufficient_privilege then null;
    end;
    begin
      perform 1 from public.supplier_members;
      raise exception 'FAIL: anonymous membership read succeeded.';
    exception when insufficient_privilege then null;
    end;
    begin
      perform public.save_supplier_dataset(initial_revision, fixtures);
      raise exception 'FAIL: anonymous save succeeded.';
    exception when insufficient_privilege then null;
    end;
    checks := checks || '"anonymous reads and public RPC denied"'::jsonb;

    perform set_config('role', 'authenticated', true);
    -- Missing subject and a non-member subject must both fail closed.
    foreach subject in array array[null::uuid, outsider_id] loop
      perform set_config('request.jwt.claim.sub', coalesce(subject::text, ''), true);
      perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',subject)::text, true);
      if auth.uid() is distinct from subject then raise exception 'JWT-subject simulation failed.'; end if;
      if exists (select 1 from public.supplier_datasets) or exists (select 1 from public.supplier_members) then
        raise exception 'FAIL: missing/non-member identity could read data.';
      end if;
      begin
        perform public.save_supplier_dataset(initial_revision, fixtures);
        raise exception 'FAIL: missing/non-member identity could save.';
      exception when insufficient_privilege then null;
      end;
    end loop;
    checks := checks || '"missing identity and non-member reads/saves denied"'::jsonb;

    perform set_config('request.jwt.claim.sub', viewer_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',viewer_id,
      'user_metadata',jsonb_build_object('role','owner'),'app_metadata',jsonb_build_object('role','owner'))::text, true);
    if (select count(*) from public.supplier_members) <> 1
       or not exists (select 1 from public.supplier_members where user_id = viewer_id and role = 'viewer')
       or (select count(*) from public.supplier_datasets where id = 'main') <> 1 then
      raise exception 'FAIL: viewer read scope is incorrect.';
    end if;
    begin
      perform public.save_supplier_dataset(initial_revision, fixtures);
      raise exception 'FAIL: viewer save succeeded despite live membership role.';
    exception when insufficient_privilege then null;
    end;
    begin
      perform supplier_private.save_supplier_dataset(initial_revision, fixtures);
      raise exception 'FAIL: viewer bypassed wrapper through private implementation.';
    exception when insufficient_privilege then null;
    end;
    checks := checks || '"viewer reads own membership/shared dataset; both save paths denied"'::jsonb;

    perform set_config('request.jwt.claim.sub', editor_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',editor_id)::text, true);
    if (select count(*) from public.supplier_members) <> 1
       or not exists (select 1 from public.supplier_members where user_id = editor_id) then
      raise exception 'FAIL: editor could read another membership or not their own.';
    end if;
    begin
      update public.supplier_datasets set suppliers = fixtures where id = 'main';
      raise exception 'FAIL: editor direct table write succeeded.';
    exception when insufficient_privilege then null;
    end;
    begin
      update public.supplier_members set role = 'owner' where user_id = editor_id;
      raise exception 'FAIL: editor could escalate membership.';
    exception when insufficient_privilege then null;
    end;
    saved := public.save_supplier_dataset(initial_revision, fixtures);
    if saved->>'id' <> 'main' or (saved->>'revision')::integer <> initial_revision + 1
       or saved->'suppliers' <> fixtures or (saved->>'updated_by')::uuid <> editor_id then
      raise exception 'FAIL: editor save result is incorrect.';
    end if;
    begin
      perform public.save_supplier_dataset(initial_revision, '[]'::jsonb);
      raise exception 'FAIL: stale revision overwrote newer data.';
    exception when serialization_failure then null;
    end;
    if (select to_jsonb(d) from public.supplier_datasets d where id = 'main') <> saved then
      raise exception 'FAIL: rejected conflict changed the dataset.';
    end if;
    begin
      perform public.save_supplier_dataset(initial_revision + 1, '[null]'::jsonb);
      raise exception 'FAIL: invalid supplier row was accepted.';
    exception when invalid_parameter_value then null;
    end;
    begin
      perform public.save_supplier_dataset(null, fixtures);
      raise exception 'FAIL: null revision was accepted.';
    exception when invalid_parameter_value then null;
    end;
    checks := checks || '"editor RPC succeeds; direct writes/escalation/invalid inputs/stale revision denied"'::jsonb;

    perform set_config('role', admin_role, true);
    update public.supplier_members set active = false where user_id = editor_id;
    perform set_config('role', 'authenticated', true);
    -- Keep the editor JWT claims unchanged to test immediate membership revocation.
    if exists (select 1 from public.supplier_datasets) or exists (select 1 from public.supplier_members) then
      raise exception 'FAIL: revoked member can still read.';
    end if;
    begin
      perform public.save_supplier_dataset(initial_revision + 1, fixtures);
      raise exception 'FAIL: revoked member can still save.';
    exception when insufficient_privilege then null;
    end;
    checks := checks || '"revoked member denied with unchanged JWT claims"'::jsonb;

    perform set_config('request.jwt.claim.sub', owner_id::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',owner_id)::text, true);
    saved := public.save_supplier_dataset(initial_revision + 1, fixtures);
    if (saved->>'revision')::integer <> initial_revision + 2 or (saved->>'updated_by')::uuid <> owner_id then
      raise exception 'FAIL: owner save result is incorrect.';
    end if;
    checks := checks || '"owner RPC succeeds"'::jsonb;

    -- This exception intentionally rolls back the complete fixture/test block.
    raise exception using errcode = 'ZQ001', message = 'Rollback-only test block completed.';
  exception when sqlstate 'ZQ001' then null;
  end;

  if current_user <> admin_role then raise exception 'Role was not restored after test rollback.'; end if;
  if exists (select 1 from auth.users where id in (owner_id, editor_id, viewer_id))
     or exists (select 1 from public.supplier_members where user_id in (owner_id, editor_id, viewer_id)) then
    raise exception 'FAIL: synthetic fixtures survived the rollback.';
  end if;
  if (select to_jsonb(d) from public.supplier_datasets d where id = 'main') is distinct from baseline then
    raise exception 'FAIL: the real dataset changed after rollback.';
  end if;
  perform set_config('supplier_atlas.verification', jsonb_build_object(
    'passed', true, 'checks', checks, 'fixtures_removed', true, 'dataset_unchanged', true)::text, true);
end;
$verification$;

select current_setting('supplier_atlas.verification')::jsonb as verification;
rollback;
