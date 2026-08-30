-- Upgrade an existing LabelECG database for real ECG image annotation.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, username, email, role, hospital_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)) || '-' || left(new.id::text, 6), new.email,
    'annotator',
    new.raw_user_meta_data->>'hospital_name');
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.ecg_records
  add column if not exists source_type text not null default 'waveform',
  add column if not exists image_path text,
  add column if not exists image_mime_type text,
  add column if not exists image_original_name text;

do $$ begin
  alter table public.ecg_records add constraint ecg_records_source_type_check
    check (source_type in ('waveform', 'image'));
exception when duplicate_object then null;
end $$;

alter table public.annotations
  add column if not exists image_marks jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ecg-images', 'ecg-images', false, 20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/bmp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$ begin
  create policy "authenticated upload ecg images" on storage.objects
    for insert to authenticated with check (bucket_id = 'ecg-images');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated read ecg images" on storage.objects
    for select to authenticated using (bucket_id = 'ecg-images');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "authenticated delete ecg images" on storage.objects
    for delete to authenticated using (bucket_id = 'ecg-images');
exception when duplicate_object then null; end $$;
