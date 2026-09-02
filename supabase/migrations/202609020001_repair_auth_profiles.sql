-- Repair authentication profiles for accounts created before the
-- public.users bootstrap trigger was installed.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, username, email, role, hospital_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)) || '-' || left(new.id::text, 6),
    new.email,
    'annotator',
    new.raw_user_meta_data->>'hospital_name'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.users (id, username, email, role, hospital_name)
select
  auth_user.id,
  coalesce(auth_user.raw_user_meta_data->>'username', split_part(auth_user.email, '@', 1)) || '-' || left(auth_user.id::text, 6),
  auth_user.email,
  'annotator',
  auth_user.raw_user_meta_data->>'hospital_name'
from auth.users auth_user
left join public.users profile on profile.id = auth_user.id
where profile.id is null
on conflict (id) do nothing;
