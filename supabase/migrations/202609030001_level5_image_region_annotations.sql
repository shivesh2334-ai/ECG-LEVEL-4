-- =============================================================================
-- ECG-LEVEL-5: session-scoped annotations for image-based ECG records
-- Additive migration; preserves the legacy annotations.image_marks workflow.
-- =============================================================================

create table if not exists public.image_region_annotations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.annotation_sessions(id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  x numeric not null check (x between 0 and 1),
  y numeric not null check (y between 0 and 1),
  width numeric not null check (width > 0 and width <= 1),
  height numeric not null check (height > 0 and height <= 1),
  lead_name text,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (x + width <= 1),
  check (y + height <= 1)
);

create index if not exists image_region_annotations_session_idx
  on public.image_region_annotations(session_id);

drop trigger if exists set_image_region_annotations_updated_at
  on public.image_region_annotations;
create trigger set_image_region_annotations_updated_at
  before update on public.image_region_annotations
  for each row execute procedure public.set_updated_at();

alter table public.image_region_annotations enable row level security;

drop policy if exists "members read image regions" on public.image_region_annotations;
create policy "members read image regions" on public.image_region_annotations
  for select using (exists (
    select 1
    from public.annotation_sessions s
    join public.ecg_records r on r.id = s.ecg_record_id
    where s.id = session_id
      and public.can_access_dataset(r.dataset_id)
  ));

drop policy if exists "owners edit image regions" on public.image_region_annotations;
create policy "owners edit image regions" on public.image_region_annotations
  for all using (public.session_is_editable(session_id))
  with check (public.session_is_editable(session_id));

create or replace function public.replace_image_region_annotations(
  session_uuid uuid,
  regions jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.session_is_editable(session_uuid) then
    raise exception 'Annotation session is not editable';
  end if;

  if regions is null or jsonb_typeof(regions) <> 'array' then
    raise exception 'regions must be a JSON array';
  end if;

  delete from public.image_region_annotations
  where session_id = session_uuid;

  insert into public.image_region_annotations (
    session_id, label, x, y, width, height, lead_name, attributes
  )
  select
    session_uuid,
    region.label,
    region.x,
    region.y,
    region.width,
    region.height,
    nullif(region.lead_name, ''),
    coalesce(region.attributes, '{}'::jsonb)
  from jsonb_to_recordset(regions) as region(
    label text,
    x numeric,
    y numeric,
    width numeric,
    height numeric,
    lead_name text,
    attributes jsonb
  );
end;
$$;

revoke all on function public.replace_image_region_annotations(uuid, jsonb) from public;
grant execute on function public.replace_image_region_annotations(uuid, jsonb) to authenticated;

comment on table public.image_region_annotations is
  'Normalized bounding-box annotations on image-based ECG records, owned by a Level 5 annotation session.';
comment on function public.replace_image_region_annotations(uuid, jsonb) is
  'Atomically replaces all image regions in an editable Level 5 draft session.';
