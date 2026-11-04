-- Greenhub admin/signup repair migration.
-- Run this once in Supabase Dashboard -> SQL Editor as the database owner.
-- Never run it through supabase-js and never put a service-role key in the browser.

create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('admin', 'customer');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists role public.app_role not null default 'customer';
alter table public.profiles add column if not exists created_at timestamptz not null default now();

-- Auth rolls back a signup when this trigger raises an error. Keeping the
-- function small, idempotent, and security-definer prevents the common
-- "Database error saving new user" 500 response.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Some existing Greenhub databases have no unique constraint on profiles.id.
  -- Avoid ON CONFLICT here so the repair also works with that schema.
  if not exists (select 1 from public.profiles where id = new.id) then
    insert into public.profiles (id, full_name, email, role)
    values (
      new.id,
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.email, ''),
      'customer'::public.app_role
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users created before the trigger was installed. Keep
-- any existing role, especially an administrator's role. This is deliberately
-- written without ON CONFLICT because older profiles tables may not have a
-- unique constraint on id.
update public.profiles as profile
set full_name = coalesce(profile.full_name, nullif(users.raw_user_meta_data ->> 'full_name', '')),
    email = coalesce(profile.email, nullif(users.email, ''))
from auth.users as users
where profile.id = users.id;

insert into public.profiles (id, full_name, email, role)
select
  users.id,
  nullif(users.raw_user_meta_data ->> 'full_name', ''),
  nullif(users.email, ''),
  'customer'::public.app_role
from auth.users users
where not exists (
  select 1
  from public.profiles existing_profile
  where existing_profile.id = users.id
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'::public.app_role
  );
$$;

create or replace function public.set_member_role(p_member_id uuid, p_role public.app_role)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_profile public.profiles;
  admin_count integer;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Only an administrator can change member roles';
  end if;

  if p_member_id is null then
    raise exception 'A member is required';
  end if;

  if p_role <> 'admin'::public.app_role and p_member_id = auth.uid() then
    raise exception 'You cannot revoke your own admin access';
  end if;

  if p_role <> 'admin'::public.app_role then
    select count(*) into admin_count
    from public.profiles
    where role = 'admin'::public.app_role;

    if admin_count <= 1 then
      raise exception 'Greenhub must keep at least one administrator';
    end if;
  end if;

  update public.profiles
  set role = p_role
  where id = p_member_id
  returning * into updated_profile;

  if not found then
    raise exception 'Member not found';
  end if;

  return updated_profile;
end;
$$;

alter table public.profiles enable row level security;

drop policy if exists "Admins manage profiles" on public.profiles;
drop policy if exists "Admins can view profiles" on public.profiles;
create policy "Admins can view profiles" on public.profiles
  for select using (public.is_admin() or id = auth.uid());

grant select on public.profiles to authenticated;
grant usage on type public.app_role to authenticated;
grant execute on function public.set_member_role(uuid, public.app_role) to authenticated;

-- If the first admin was already created, this is not needed. Otherwise run:
-- update public.profiles set role = 'admin' where id = 'AUTH_USER_UUID';
