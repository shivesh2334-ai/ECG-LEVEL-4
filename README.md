# LabelECG (ECG-LEVEL-4)

A distributed ECG annotation platform for real ECG scans, photographs, exported
images, and digitized 12-lead waveforms. Annotators can draw labeled regions on
an ECG image, record structured findings and confidence, or inspect waveform
samples lead by lead. Experts/admins retain the existing review workflow.

> ⚠️ **Security note:** an earlier version of this repo accidentally committed
> real Supabase credentials (service role key, JWT secret, database
> password) inside a folder that was meant to be named `.gitignore` but was
> actually a tracked directory. Those files have been removed here and a
> proper `.gitignore` added. **If you're reusing that Supabase project,
> rotate the service role key, JWT secret, and database password in the
> Supabase dashboard before going further** — anything committed to a public
> repo should be treated as compromised even after deletion, since it may
> still exist in git history or in clones/forks.

## What changed in this update

- **Real ECG image annotation.** Batch upload JPG/JPEG, PNG, WebP, or BMP ECG
  files. Drag normalized, labeled boxes over P waves, QRS complexes, T waves,
  ST segments, artifacts, rhythm strips, or other regions. Markings stay aligned
  at different screen sizes and are saved with the annotation.
- **Private image storage.** Image binaries now live in the private Supabase
  Storage bucket `ecg-images`; Postgres stores only record metadata and storage
  paths. The browser receives a one-hour signed URL when a record is opened.
- **Structured annotation.** Diagnosis, findings, confidence (0–100), status,
  and image regions are persisted. Existing team review, audit history, dataset
  progress, account history, CSV import, and waveform displays remain in place.
- **Working authentication bootstrap.** New accounts are created through
  Supabase Auth and a database trigger creates the matching application profile.
- **Passwordless email login.** Existing users can select **Email me a sign-in
  link** and authenticate through a Supabase Magic Link without entering a
  password. Unknown addresses are not silently registered.

- **Real ECG data only.** All hardcoded demo datasets, demo user accounts,
  and randomly-generated waveform data have been removed. The previous
  upload flow parsed a few metadata fields from a CSV and then *replaced the
  actual ECG signal with random noise* — that's fixed. Uploads now require
  and store your real digitized lead samples end to end.
- **Real backend.** The app used `window.storage`, which only exists inside
  the Claude.ai artifact sandbox — it silently does nothing in a real
  deployed app (e.g. on Vercel). Storage now goes through Supabase
  (Postgres + Auth), using the `src/lib/supabase.js` service layer that
  already existed in the repo but wasn't wired up.
- **Fixed a real bug:** `src/lib/supabase.js` read `process.env.NEXT_PUBLIC_*`,
  which doesn't exist in a Vite app (this project uses Vite, not Next.js).
  It now correctly reads `import.meta.env.VITE_*`.
- **Scalable record loading.** Previously, opening a dataset loaded every
  record's full 12-lead waveform into memory at once. Now the dataset
  browser only loads lightweight metadata, and a record's waveform is
  fetched on demand when you open it.

## 1. Prerequisites

- Node.js 18+
- A free [Supabase](https://supabase.com) project

## 2. Set up the database

1. Create a new Supabase project.
2. For a new database, open **SQL Editor**, paste the contents of
   [`supabase/schema.sql`](./supabase/schema.sql), and run it. This creates
   the tables, private Storage bucket, RLS policies, auth-profile trigger, and
   SQL functions used by the app.
3. For an existing LabelECG database, run only
   [`supabase/migrations/202608290001_image_annotation.sql`](./supabase/migrations/202608290001_image_annotation.sql).
   It is an additive migration and preserves existing datasets and waveforms.
4. In **Authentication → Providers**, make sure Email sign-up is enabled.
   For local development you may want to disable "Confirm email" so you can
   log in immediately after registering.
5. In **Authentication → URL Configuration**, set **Site URL** to the deployed
   application URL. Add the production URL and `http://localhost:5173` to the
   allowed Redirect URLs as appropriate. Supabase accepts Magic Link callbacks
   only for allowed destinations.
6. If this Supabase project contains accounts created before the application
   profile trigger was installed, run
   [`supabase/migrations/202609020001_repair_auth_profiles.sql`](./supabase/migrations/202609020001_repair_auth_profiles.sql).
   It backfills missing `public.users` rows without changing existing profiles.

### Passwordless Magic Link login

On the login screen, enter the email address of an existing account and select
**Email me a sign-in link**. Open the link delivered by Supabase; the browser
returns to the app with an authenticated session. For security, the app passes
`shouldCreateUser: false`, so account registration remains a separate action.

The default Supabase email service is suitable for initial testing but is
rate-limited. Configure a production SMTP provider under **Authentication →
Emails/SMTP** before onboarding clinical users.

The default RLS policies are intentionally permissive (any signed-in user
can read/write most tables) to get you running quickly. Before using this
with real patient data, tighten the policies in `schema.sql` to your
institution's requirements — e.g. restricting the `review` action to
`expert`/`admin` roles, or scoping datasets by hospital.

## 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env` with your project's values from **Project Settings → API**:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Only use the **anon/public** key here — never the service role key, which
must never be shipped to the browser.

## 4. Install and run

```bash
npm install
npm run dev
```

Open the printed local URL. Register an account (choose your role —
annotator, expert, or admin), then sign in.

For production:

```bash
npm run build
npm run preview   # or deploy dist/ (this repo includes vercel.json for Vercel)
```

If deploying to Vercel, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
as environment variables in the Vercel project settings — `.env` files are
not deployed.

## 5. Uploading and annotating real ECGs

### ECG images

Choose **ECG images**, enter a dataset name, and select one or more JPG/JPEG,
PNG, WebP, or BMP files (maximum 20 MB each). Each file becomes one record. The
filename without its extension is used as the initial patient/record identifier;
use de-identified filenames before upload.

On the annotation screen, choose a region label and drag a box over the image.
Add the clinical interpretation, structured findings, and confidence, then save
as Confirmed or Unsure. Image regions are stored as normalized JSON coordinates,
not burned into or used to modify the original image.

TIFF, PDF, DICOM, SCP-ECG, and HEIC are not accepted directly because browser
support is inconsistent. Convert page/image exports to PNG or JPEG before upload.

### Digitized waveform CSV

Go to **Upload Data**. The uploader expects a CSV with one row per ECG
record and these columns (header required, in any order):

| Column | Required | Notes |
|---|---|---|
| `patient_id` | yes | Any text identifier |
| `timestamp` | no | ISO 8601; defaults to upload time |
| `heart_rate`, `pr_interval`, `qrs_duration`, `qt_interval` | no | Integers (ms/bpm) |
| `sampling_rate` | no | Samples per second; defaults to 500 |
| `auto_analysis` | no | Free text, e.g. output of an automated reader |
| `lead_I`, `lead_II`, `lead_III`, `lead_aVR`, `lead_aVL`, `lead_aVF`, `lead_V1`–`lead_V6` | yes | Each cell holds that lead's **real sample values**, separated by semicolons (`;`) — e.g. `0.012;0.014;-0.003;...` |

All 12 leads in a row must have the same number of samples. A row that's
missing lead data, or has non-numeric values, is rejected with an error
rather than being padded with placeholder values — there is no synthetic
data fallback anywhere in the upload path.

A blank header-only template is at
[`public/sample-ecg-template.csv`](./public/sample-ecg-template.csv), and is
also linked from the Upload screen.

**Where do real sample values come from?** Typically you'd export them from
your ECG device/EMR, or convert a standard research format (e.g. a
[PhysioNet/WFDB](https://physionet.org/) record) to this CSV shape with a
small script — read each lead's signal array and join it with `;`.

## 6. Project structure

```
src/
  App.jsx              — UI and view logic
  lib/
    supabase.js        — Supabase client + all data-access functions
    ecgFileParser.js    — real-CSV → record parser (no synthetic data)
  components/
    EcgImageAnnotator.jsx — resolution-independent image region annotation
  main.jsx
supabase/
  schema.sql           — tables, RLS policies, SQL functions
  migrations/          — additive upgrades for an existing database
public/
  sample-ecg-template.csv
.env.example
```

## 7. Known limitations / next steps

- New registrations are always assigned `annotator`. Promote vetted users to
  `expert` or `admin` through a controlled administrative database workflow.
- WFDB, DICOM, SCP-ECG, TIFF, PDF, and HEIC still require conversion before
  upload; their parsing dependencies and vendor variations are not bundled in
  this browser-only client.
- The Supabase RLS policies here are a starting point, not a HIPAA/clinical
  compliance package — review them with your institution before storing
  real patient data.
