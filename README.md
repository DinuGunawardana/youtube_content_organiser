# YouTube Content Organiser — v2

A Next.js app for importing individual YouTube links, extracting metadata, and organising videos into categories and subcategories.

## Features
- Create categories and subcategories.
- Import links by pasting them or uploading CSV.
- CSV can specify a category and subcategory for each URL.
- Categories/subcategories in the CSV are created automatically if missing.
- Duplicate detection by YouTube video ID.
- Existing videos are never replaced or modified by an import.
- Repeated links inside the same CSV/import are also skipped.
- Search/filter videos and export the library to CSV.

## Important storage note
This starter stores categories and videos in the browser's `localStorage`. That means the library persists in the same browser profile on the same device, but it is not shared between users/devices and can be lost if browser data is cleared. Export the library CSV for backup. For a multi-user or permanent hosted system, connect a database such as Supabase or PostgreSQL and add authentication.

## Requirements
- Node.js 20+
- Python 3.9+
- `yt-dlp` installed and available on the server PATH

## Install
```bash
npm install
python -m pip install -U yt-dlp
```

Windows:
```powershell
py -m pip install -U yt-dlp
```
Ensure the Python Scripts directory is on PATH so the Next.js process can find `yt-dlp`.

## Run
```bash
npm run dev
```
Visit http://localhost:3000

## CSV format
Required column: `URL` (also accepts `YouTube URL`, `Video URL`, or `Link`).

Optional columns: `Category`, `Subcategory`.

Example:
```csv
URL,Category,Subcategory
https://www.youtube.com/watch?v=VIDEO_ID,Food,Recipes
https://youtu.be/VIDEO_ID,DIY,Home Projects
https://www.youtube.com/watch?v=ANOTHER_ID,Agriculture,Organic Farming
```

If the CSV has no Category/Subcategory columns, the current category selection is used for pasted links; CSV rows without category values are placed under the first category ("Food") unless changed in the code.

## Duplicate policy
- Duplicate identity is the YouTube video ID, not the full URL. Different URL formats for the same video are treated as the same video.
- Existing records are skipped. They are not overwritten, re-categorised or refreshed.
- Repeated video IDs in one import are only processed once.
- Invalid URLs are skipped and counted.
- Extraction failures are reported; they do not create empty records.

## Deployment security
The extraction API invokes yt-dlp on submitted URLs. This is designed for a local or trusted internal app. Before exposing it publicly, add authentication, rate limiting, request quotas, and preferably a job queue. Keep yt-dlp updated. The app only accepts YouTube hosts, but production systems should also validate and monitor outbound requests to mitigate SSRF and abuse.
