-- Restore the real ECG image workflow on legacy Level 4 deployments.
-- Safe to run after 202609020002_ecg_level_5_schema.sql.

alter table public.ecg_records
  add column if not exists source_type text not null default 'waveform',
  add column if not exists image_path text,
  add column if not exists image_mime_type text,
  add column if not exists image_original_name text;

do $image_source_constraint$
begin
  alter table public.ecg_records
    add constraint ecg_records_source_type_check
    check (source_type in ('waveform', 'image'));
exception when duplicate_object then null;
end
$image_source_constraint$;

alter table public.annotations
  add column if not exists image_marks jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ecg-images',
  'ecg-images',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'application/pdf']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated upload ECG images" on storage.objects;
drop policy if exists "dataset members read ECG images" on storage.objects;
drop policy if exists "owners delete ECG images" on storage.objects;

create policy "authenticated upload ECG images"
on storage.objects for insert to authenticated
with check (bucket_id = 'ecg-images');

create policy "dataset members read ECG images"
on storage.objects for select to authenticated
using (
  bucket_id = 'ecg-images'
  and exists (
    select 1
    from public.ecg_records r
    where r.image_path = name
      and public.can_access_dataset(r.dataset_id)
  )
);

create policy "owners delete ECG images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'ecg-images'
  and exists (
    select 1
    from public.ecg_records r
    where r.image_path = name
      and public.can_manage_dataset(r.dataset_id)
  )
);

update public.annotation_protocols
set status = 'active'
where name = 'LabelECG Core Annotation Protocol'
  and version = '1.0.0'
  and status = 'draft';

create index if not exists ecg_records_source_type_idx
  on public.ecg_records(dataset_id, source_type);

comment on column public.annotations.image_marks is
  'Normalized image-coordinate boxes used by the real ECG image annotator.';
