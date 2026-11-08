# Content Organiser

A personal web application for collecting links from YouTube, social
platforms, articles and other websites, retrieving basic metadata where
available, and organising content into custom categories and
subcategories. The app supports individual URL imports, CSV imports,
duplicate detection, live import progress, CSV reports, search and
filtering, and bulk deletion.

## Contents

-   [Features](#features)
-   [Technology stack](#technology-stack)
-   [Requirements](#requirements)
-   [Getting started locally](#getting-started-locally)
-   [YouTube Data API configuration](#youtube-data-api-configuration)
-   [Environment variables](#environment-variables)
-   [Importing videos](#importing-videos)
-   [CSV format](#csv-format)
-   [Import statuses and duplicate
    handling](#import-statuses-and-duplicate-handling)
-   [Managing the library](#managing-the-library)
-   [Data storage and backups](#data-storage-and-backups)
-   [Deploying to Netlify](#deploying-to-netlify)
-   [API endpoint](#api-endpoint)
-   [Known limitations](#known-limitations)
-   [Troubleshooting](#troubleshooting)

## Features

### Link importing

-   Paste one or more public website URLs, one URL per line. YouTube, articles, Facebook, Instagram, TikTok, Pinterest, LinkedIn, Reddit and other HTTP/HTTPS links are accepted.
-   Upload a CSV file containing video URLs and optional category
    information.
-   Process imports sequentially: the next URL is processed after the
    current URL has a result.
-   Display progress and per-link outcomes while importing.
-   Save successfully imported links to the browser library.
-   Download an import-results CSV containing the status and reason for
    each processed URL.

### Organisation

-   Create custom categories and subcategories.
-   Assign imported videos to categories and subcategories.
-   Search video titles, channel names and video IDs.
-   Filter the library by category and subcategory.
-   Move an existing video to another category.

### Duplicate handling

-   Identify videos by their YouTube video ID rather than the complete
    URL.
-   Skip videos that already exist in the library.
-   Skip repeated video IDs found within the same import.
-   Do not overwrite existing video records during import.

### Library management

-   Export the saved library as a CSV file.
-   Select individual videos or all currently visible videos.
-   Clear the current selection.
-   Delete multiple selected videos after a confirmation prompt.
-   Remove an individual video from the library.

> Deleting a video removes its record from this organiser only. It does
> not delete the video from YouTube.

## Technology stack

-   **Next.js 15** --- application framework and API route.
-   **React 19** --- user interface.
-   **TypeScript 5** --- application code.
-   **YouTube Data API v3** --- video metadata lookup.
-   **Browser localStorage** --- local library and import-result
    persistence.

## Requirements

-   Node.js 20 or later (recommended).
-   npm.
-   A Google Cloud project with YouTube Data API v3 enabled and an API
    key for metadata extraction.

Check your installed versions:

``` bash
node --version
npm --version
```

## Getting started locally

1.  Extract the project ZIP.

2.  Open the project folder in a terminal or VS Code.

3.  Install dependencies:

    ``` bash
    npm install
    ```

4.  Create a `.env.local` file in the project root and add your YouTube
    API key (see [Environment variables](#environment-variables)).

5.  Start the development server:

    ``` bash
    npm run dev
    ```

6.  Open <http://localhost:3000>.

### Available commands

  Command           Purpose
  ----------------- --------------------------------------------
  `npm install`     Install project dependencies
  `npm run dev`     Start the local development server
  `npm run build`   Create a production build
  `npm run start`   Start the production server after building

## YouTube Data API configuration

This project version uses the official YouTube Data API v3. It does
**not** launch `yt-dlp` and does not require `yt-dlp` to be installed on
the local machine or Netlify.

To create an API key:

1.  Open [Google Cloud Console](https://console.cloud.google.com/).
2.  Create or select a Google Cloud project.
3.  Open **APIs & Services → Library**.
4.  Find and enable **YouTube Data API v3**.
5.  Open **APIs & Services → Credentials**.
6.  Create an **API key**.
7.  Under API restrictions, restrict the key to **YouTube Data API v3**.
8.  Keep the key private. Do not commit it to source control or expose
    it in browser code.

The API route requests the `snippet` and `contentDetails` parts for a
video. The app uses the returned title, channel, thumbnail, duration and
publication date.

### Metadata date note

The YouTube Data API returns `publishedAt`. This is a publication date
and is not guaranteed to be the original upload date in every case. The
app stores it in the `uploadDate` field for display/export
compatibility.

## Environment variables

The API key must be available only on the server.

Create `.env.local` in the project root:

``` env
YOUTUBE_API_KEY=your_google_cloud_youtube_data_api_v3_key
```

The repository includes `.env.example` as a reference. Do not use
`NEXT_PUBLIC_YOUTUBE_API_KEY`; variables with the `NEXT_PUBLIC_` prefix
are exposed to browser code.

Do not commit `.env.local` or share your API key publicly.

## Importing links

### Paste URLs

1.  Open the organiser.
2.  Paste one website URL per line into **Paste links**. Full `https://` URLs and bare domains such as `instagram.com/...` are accepted.
3.  Select the intended category and subcategory in the sidebar.
4.  Click **Import pasted links**.
5.  Watch the import results panel. Each URL is processed and reported
    individually.

Pasted URLs use the currently selected category and subcategory.

### Upload a CSV

1.  Prepare a CSV using the format below.
2.  Select **Browse CSV** in the import panel.
3.  Choose the file.
4.  The organiser processes the rows sequentially and displays the
    results.
5.  Select **Download results CSV** to save the processing report.

When category or subcategory names are provided in the CSV, the
organiser can create missing category/subcategory entries as it
processes the import. If the CSV omits these fields, the currently
selected category/subcategory is used where applicable.

## CSV format

The URL column is required. The importer recognises these URL header
names:

-   `URL`
-   `YouTube URL`
-   `Video URL`
-   `Link`

Optional columns:

-   `Category` (also accepts `Main Category`)
-   `Subcategory` (also accepts `Sub-category` or `Sub Category`)

Example:

``` csv
URL,Category,Subcategory
https://www.youtube.com/watch?v=VIDEO_ID,Food,Recipes
https://www.facebook.com/example/posts/123,Social Media,Facebook
https://www.instagram.com/p/EXAMPLE/,Social Media,Instagram
```

The CSV parser supports quoted fields, escaped quotes, commas and
newlines within quoted fields. Use UTF-8 CSV where possible.

## Import statuses and duplicate handling

Each processed row receives one of the following statuses:

  -----------------------------------------------------------------------
  Status                              Meaning
  ----------------------------------- -----------------------------------
  `ADDED`                             The link and any available metadata
                                      were saved to this browser's
                                      library.

  `SKIPPED – DUPLICATE`               The video already exists in the
                                      library, or the same video ID
                                      appeared earlier in the current
                                      import.

  `SKIPPED – INVALID URL`             The URL is not a valid public HTTP
                                      or HTTPS website URL.

  `SKIPPED – EXTRACTION FAILED`       A required extraction step failed.
                                      Non-YouTube metadata failures use a
                                      fallback card and do not block saving.
  -----------------------------------------------------------------------

The import-results CSV contains:

-   URL
-   Category
-   Subcategory
-   Status
-   Reason
-   Video Title
-   Processed At

A successful HTTP response from the API does not, by itself, mean a
video was added. The app marks a row `ADDED` only after it has saved the
video record in localStorage.

## Managing the library

### Search and filters

Use the search box to find videos by title, channel or video ID. Use the
category and subcategory filters to narrow the displayed cards.

### Move a video

Use **Move to category** on a video card to assign it to another
category. In the current implementation, changing the category also
assigns that category's first subcategory, if one exists.

### Bulk delete

1.  Tick the checkbox on each video you want to remove.
2.  Use **Select visible** to select all videos currently shown by the
    search and filters.
3.  Use **Deselect visible** to unselect the currently visible videos.
4.  Use **Clear selection** to clear all selected videos.
5.  Click **Delete selected**.
6.  Review the confirmation prompt before proceeding.

The bulk-delete operation removes the selected records from the current
browser's library. It does not delete YouTube content.

## Data storage and backups

**Important: this version uses browser localStorage, not a hosted
database.**

-   The library is saved in the browser profile that is being used.
-   The library is not automatically synchronised between devices,
    browsers or users.
-   Deploying the app to Netlify does not move the library into Netlify
    storage.
-   Clearing browser site data, changing browser profiles, or using a
    different device can make the saved library unavailable.
-   Import results are also stored locally in the browser.

### Back up your data

Use both export options regularly:

-   **Export library CSV** --- backs up saved video metadata and
    category assignments.
-   **Download results CSV** --- backs up the latest import processing
    report.

The library CSV can be used as a source for later re-importing, but it
is not a complete backup of the app's internal state: category
definitions with no videos and all browser settings are not represented.
For durable multi-device storage, the app would need a database and an
import/migration process.

## Deploying to Netlify

1.  Push the project to a Git repository connected to Netlify, or deploy
    it using your chosen Netlify workflow.
2.  In Netlify, open the site's environment-variable settings.
3.  Add the variable `YOUTUBE_API_KEY` with your Google API key.
4.  Ensure the variable is available to the deployed server-side
    function/runtime.
5.  Trigger a new deployment after adding or changing the variable.
6.  Test the deployed app with a public YouTube video URL and a few non-YouTube links before
    importing a larger CSV.

The YouTube extraction endpoint is `/api/extract`; the non-YouTube metadata endpoint is `/api/metadata`. The YouTube key is read on the server
from `process.env.YOUTUBE_API_KEY`.

See [`NETLIFY_SETUP.md`](./NETLIFY_SETUP.md) for the deployment-specific
checklist.

## API endpoint

### `POST /api/extract`

Request body:

``` json
{
  "urls": [
    "https://www.youtube.com/watch?v=VIDEO_ID"
  ]
}
```

Successful result example:

``` json
{
  "results": [
    {
      "url": "https://www.youtube.com/watch?v=VIDEO_ID",
      "video": {
        "id": "VIDEO_ID",
        "title": "Example video title",
        "thumbnail": "https://example.com/thumbnail.jpg",
        "url": "https://www.youtube.com/watch?v=VIDEO_ID",
        "channel": "Example channel",
        "duration": 120,
        "uploadDate": "20260101"
      }
    }
  ]
}
```

An individual failure is returned in the corresponding result's `error`
field. The route validates supported HTTPS YouTube URLs and accepts up
to 100 URL strings per request. The frontend importer processes URLs
sequentially; the route also iterates through submitted URLs
sequentially.

### `POST /api/metadata`

Request body:

```json
{ "url": "https://example.com/article" }
```

Returns a best-effort `metadata` object containing `title`, `thumbnail`,
`platform`, and `contentType`. It checks selected oEmbed providers and public
Open Graph/Twitter card or HTML title metadata. No API key is required.
If metadata is blocked or unavailable, the importer still saves the URL using
its fallback title and platform information.

## Known limitations

1.  **Local-only library:** localStorage is not a central database and
    does not synchronise between devices.
2.  **Browser storage limits:** localStorage has finite capacity and
    stores data as strings. Very large libraries may eventually require
    a database.
3.  **YouTube API availability:** private, deleted, age-restricted,
    region-restricted or otherwise unavailable videos may not return
    metadata.
4.  **API quota:** YouTube Data API usage is subject to the quota and
    policies of the Google Cloud project. Monitor quota in Google Cloud
    Console.
5.  **Metadata differences:** `publishedAt` is not necessarily the
    original upload date.
6.  **No user authentication:** the current app does not provide user
    accounts or per-user access control.
7.  **No cloud backup:** exporting CSV files is currently the manual
    backup mechanism.
8.  **No YouTube deletion:** removing a card only removes the local
    library record.

## Troubleshooting

### `YOUTUBE_API_KEY is not configured on the server`

-   Check that the environment variable is named exactly
    `YOUTUBE_API_KEY`.
-   Check that it is configured in Netlify's environment-variable
    settings.
-   Redeploy after adding or changing it.

### API key or API not enabled error

-   Confirm YouTube Data API v3 is enabled in the Google Cloud project
    that owns the key.
-   Check that the key is valid and its API restriction allows YouTube
    Data API v3.
-   Review Google Cloud quota and API status.

### Video cannot be found

The video may be private, deleted, unavailable, or restricted. Test with
a public video URL.

### Import results are not visible after switching devices

The library and import report are saved in localStorage for the
browser/device in use. They are not synced through Netlify.

### A video is marked duplicate

The organiser compares YouTube video IDs. Different URL formats pointing
to the same video are treated as the same video.

------------------------------------------------------------------------

## Project maintenance

-   Keep dependencies updated and review security advisories.
-   Keep the YouTube API key private and restrict it to the required
    API.
-   Export the library and import-results CSV regularly.
-   Test with a small import after code or deployment changes.
-   Before using this as a public multi-user service, add
    authentication, server-side persistence, rate limiting and abuse
    protection.


### Non-YouTube links

The organiser identifies common platforms such as Facebook, Instagram, TikTok, Pinterest, LinkedIn, X/Twitter, Reddit, Threads, Telegram and YouTube channel/playlist pages. Other valid website links are classified as articles or general website links based on their domain and URL path. For non-YouTube links, the app attempts to retrieve a title and thumbnail from public Open Graph/Twitter card metadata and selected oEmbed providers. If metadata is unavailable, it still saves the URL with a readable fallback title and platform preview card. It does not bypass private/login-protected pages or platform restrictions.


## Basic metadata extraction

For non-YouTube URLs, `/api/metadata` attempts to retrieve a title and thumbnail using public Open Graph/Twitter card metadata and selected oEmbed providers (TikTok, Reddit, and X/Twitter). It also identifies the platform and basic content type. This is best-effort and does not bypass login walls, private content, bot protections, or platform API permissions. Facebook and Instagram commonly restrict automated preview access; their links remain saveable even when no title or thumbnail can be retrieved.

The metadata endpoint validates public HTTP/HTTPS destinations, checks DNS results against private/reserved IP ranges, pins the request to a validated public address, limits redirects, applies a timeout, and caps downloaded HTML size. No additional API key is required for this best-effort metadata feature. YouTube still requires `YOUTUBE_API_KEY` for its official video metadata lookup.

## Category navigation and bulk selection

- Choose the main category from the category dropdown.
- Subcategories are shown as horizontally scrollable tiles; select a tile to filter the library.
- Rename a subcategory after content has been added. Renaming preserves the existing content assignments because each item references the subcategory ID.
- Deleting a subcategory keeps its saved content in the parent category and clears only that subcategory assignment.
- On desktop, click and drag across content cards to select multiple items. Hold Shift, Ctrl, or Cmd while dragging to add to the current selection. The checkbox and Select visible controls remain available as alternatives.
- Use Delete selected to remove the selected items from this browser's library. This does not delete the original videos or posts from their platforms.
