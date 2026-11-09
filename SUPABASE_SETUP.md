# Supabase integration

This version uses the existing `content_organiser_library` table and `save_content_organiser_library` RPC. Run `content_organiser_supabase_setup.sql` in the Supabase SQL Editor if you have not already run it.

## Environment variables

Set these in local `.env.local` and in Netlify Site configuration → Environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Do not add a service-role key or database password to the browser environment.

## Install and run

```bash
npm install
npm run dev
```

The project uses `@supabase/supabase-js`. The package lockfile is intentionally omitted in this handoff so `npm install` can generate a fresh lockfile containing the new dependency. Commit the generated `package-lock.json` after installation.

## First sign-in and migration

1. Create your personal account using the app's Create account screen.
2. Confirm the email if Supabase email confirmation is enabled.
3. Sign in on the browser that contains your existing Content Organiser data.
4. If no cloud row exists, the app migrates `youtube-content-library-v2` and `youtube-content-import-log-v1` from that browser. It does not delete the local copies.
5. Wait for the sync indicator to show `All changes saved` or `Migrated ... item(s)`.
6. Then sign in on your other devices.

If you sign in on a device with no local library before migrating from the original browser, the app asks before creating a new cloud library. Do not create one until the original browser has migrated, or you will need to resolve the two sources manually.

## Conflict handling

Cloud writes use a revision-checked RPC. If another device has changed the library while this device has unsaved edits, the app keeps the local edits in memory and shows a conflict message. Use `Load cloud version` only if you intend to discard those unsaved local edits.
