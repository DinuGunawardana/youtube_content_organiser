# Netlify setup — YouTube metadata

This version uses the official YouTube Data API for YouTube video metadata and a best-effort metadata endpoint for other public websites. The non-YouTube endpoint checks Open Graph/page metadata and selected public oEmbed providers. It does not require another API key, and links remain saveable if metadata is blocked.

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

Deploy this updated project to Netlify. The YouTube API route remains `/api/extract`; non-YouTube previews use `/api/metadata`. Both are Next.js server routes and are compatible with Netlify Next.js deployment. The existing sequential importer and CSV reporting UI are preserved.

## Metadata differences and limitations

- Title, channel, thumbnail, duration, and publication date are retrieved from YouTube Data API.
- The API's `publishedAt` field is a publication date; it is not guaranteed to be the original upload date for every video.
- Private, deleted, or otherwise unavailable videos may not be returned and will be recorded as extraction failures in the import CSV.
- `videos.list` costs 1 quota unit per request. The sequential importer makes one metadata request per new URL, so 96 URLs typically use about 96 units (excluding retries and other requests).


## Non-YouTube metadata behavior

- Public Open Graph/Twitter card metadata and HTML page titles are used where available.
- TikTok, Reddit, and X/Twitter also have best-effort oEmbed lookups.
- Facebook and Instagram commonly require Meta API credentials/permissions or block server-side preview access. This version does not bypass those restrictions; it saves the URL with a fallback card when metadata is unavailable.
- LinkedIn and Pinterest previews depend on whether the public page exposes metadata to an unauthenticated request.
- Metadata is best-effort, not guaranteed. Private, login-protected, deleted, rate-limited, or bot-protected content may return only a fallback title and no thumbnail.
- The endpoint only fetches public HTTP/HTTPS destinations, validates DNS addresses, rejects private/reserved IP ranges, limits redirects and response size, and times out slow requests.


## 4. Optional: controlled Google AdSense placement

This project is configured for **one manual responsive display ad** in the content library, below the search/category filters and above the bulk-selection controls. It is not using Auto Ads. The placement is intentionally kept away from checkboxes, category actions, and Remove/Delete buttons.

1. In AdSense, add this website and complete Google's site review/approval process. Having an AdSense account does not automatically mean this particular website is approved to serve ads.
2. In AdSense, create a **Display** ad unit and copy its publisher ID (`ca-pub-...`) and the ad unit's slot ID.
3. For local testing, copy `.env.example` to `.env.local` and replace the example values:
   - `NEXT_PUBLIC_ADSENSE_CLIENT_ID=ca-pub-...`
   - `NEXT_PUBLIC_ADSENSE_LIBRARY_SLOT_ID=...`
4. In Netlify, open **Site configuration → Environment variables** and add those same two variable names with your real values.
5. Trigger a new deploy. `NEXT_PUBLIC_` values are included at build time, so an existing deployment will not pick up changes until rebuilt.

If either value is missing, the ad component and AdSense loader are omitted, and the rest of the app continues to work. Ad blockers, network restrictions, or AdSense review/serving status can also prevent an ad from appearing; that should not affect saved content.

**Important:** Do not publish the example IDs. Add an accurate privacy/cookie disclosure for advertising technologies and implement any consent requirements that apply to your visitors and target regions. Follow the current AdSense account guidance for any `ads.txt` requirement. Never place ads so they resemble navigation or library controls.


## 5. Netlify secrets-scanning configuration

The root `netlify.toml` excludes only `NEXT_PUBLIC_ADSENSE_CLIENT_ID` from Netlify's secrets scan. This is intentional: Next.js inlines `NEXT_PUBLIC_` variables into browser assets, and an AdSense publisher ID is designed to be public. Secrets scanning remains enabled for other values, including `YOUTUBE_API_KEY`.

Do not add `YOUTUBE_API_KEY` to `SECRETS_SCAN_OMIT_KEYS`, and do not disable secrets scanning globally.
