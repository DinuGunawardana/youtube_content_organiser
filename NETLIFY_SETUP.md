# Netlify setup — YouTube metadata

This version uses the official YouTube Data API for video metadata. It no longer tries to launch the `yt-dlp` executable, which is not installed in the Netlify serverless runtime by default.

## 1. Create a YouTube Data API key

1. Open Google Cloud Console: https://console.cloud.google.com/
2. Create or select a Google Cloud project.
3. Open **APIs & Services → Library**.
4. Find and enable **YouTube Data API v3**.
5. Open **APIs & Services → Credentials → Create credentials → API key**.
6. Restrict the key to **YouTube Data API v3** under API restrictions.
7. Keep the key private. Do not put it in frontend code or commit it to Git.

## 2. Add the key to Netlify

1. Open your site in Netlify.
2. Go to **Site configuration → Environment variables** (or **Project configuration → Environment variables**, depending on the Netlify UI).
3. Add a variable named exactly `YOUTUBE_API_KEY`.
4. Paste the API key as its value.
5. Ensure it is available to both the build and Functions/runtime contexts if Netlify shows scope options.
6. Trigger a fresh deploy. Updating an environment variable does not update an already deployed function until a new deploy completes.

Do not use `NEXT_PUBLIC_YOUTUBE_API_KEY`; that prefix would expose the key to browser code.

## 3. Deploy

Deploy this updated project to Netlify. The API route remains `/api/extract`, so the existing sequential importer and CSV reporting UI do not need to change.

## Metadata differences and limitations

- Title, channel, thumbnail, duration, and publication date are retrieved from YouTube Data API.
- The API's `publishedAt` field is a publication date; it is not guaranteed to be the original upload date for every video.
- Private, deleted, or otherwise unavailable videos may not be returned and will be recorded as extraction failures in the import CSV.
- `videos.list` costs 1 quota unit per request. The sequential importer makes one metadata request per new URL, so 96 URLs typically use about 96 units (excluding retries and other requests).
