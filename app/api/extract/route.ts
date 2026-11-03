import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

 type YouTubeApiVideo = {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
  };
  contentDetails?: { duration?: string };
};

type Extracted = {
  id: string;
  title: string;
  thumbnail: string;
  url: string;
  channel: string;
  duration: number | null;
  uploadDate: string;
};

function getVideoId(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (u.protocol !== "https:") return null;

    let id: string | null = null;
    if (host === "youtu.be") {
      id = u.pathname.split("/").filter(Boolean)[0] || null;
    } else if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
      id = u.searchParams.get("v");
      if (!id) {
        const parts = u.pathname.split("/").filter(Boolean);
        if (["embed", "shorts", "live"].includes(parts[0])) id = parts[1] || null;
      }
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function durationToSeconds(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function thumbnailUrl(thumbnails?: Record<string, { url?: string; width?: number; height?: number }>): string {
  if (!thumbnails) return "";
  for (const key of ["maxres", "standard", "high", "medium", "default"]) {
    const url = thumbnails[key]?.url;
    if (url) return url;
  }
  return "";
}

async function extract(url: string, apiKey: string): Promise<Extracted> {
  const id = getVideoId(url);
  if (!id) throw new Error("Invalid or unsupported YouTube URL.");

  const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
  endpoint.searchParams.set("part", "snippet,contentDetails");
  endpoint.searchParams.set("id", id);
  endpoint.searchParams.set("key", apiKey);

  const response = await fetch(endpoint.toString(), { cache: "no-store" });
  const payload = await response.json().catch(() => null) as {
    items?: YouTubeApiVideo[];
    error?: { message?: string; errors?: Array<{ reason?: string }> };
  } | null;

  if (!response.ok) {
    const reason = payload?.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      throw new Error("YouTube Data API quota exceeded. Try again after the quota resets.");
    }
    if (reason === "keyInvalid" || reason === "accessNotConfigured") {
      throw new Error("The YouTube Data API key is invalid or the YouTube Data API v3 is not enabled for its Google Cloud project.");
    }
    throw new Error(payload?.error?.message || `YouTube API request failed (HTTP ${response.status}).`);
  }

  const item = payload?.items?.[0];
  if (!item?.id || !item.snippet?.title) {
    throw new Error("YouTube did not return this video. It may be private, deleted, unavailable, or restricted.");
  }

  const thumbnail = thumbnailUrl(item.snippet.thumbnails);
  if (!thumbnail) throw new Error("YouTube did not return a thumbnail for this video.");

  return {
    id: item.id,
    title: item.snippet.title,
    thumbnail,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    channel: item.snippet.channelTitle || "",
    duration: durationToSeconds(item.contentDetails?.duration),
    // YouTube Data API exposes publishedAt (publication date), not yt-dlp's upload_date.
    uploadDate: item.snippet.publishedAt ? item.snippet.publishedAt.slice(0, 10).replace(/-/g, "") : "",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const urls: unknown = body?.urls;
    if (!Array.isArray(urls) || urls.length < 1) {
      return NextResponse.json({ error: "Provide a list of URLs." }, { status: 400 });
    }
    if (urls.length > 100 || urls.some(u => typeof u !== "string" || u.length > 2048)) {
      return NextResponse.json({ error: "Maximum 100 URLs per request; each URL must be a string no longer than 2048 characters." }, { status: 400 });
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        results: (urls as string[]).map(url => ({
          url,
          error: "YOUTUBE_API_KEY is not configured on the server. Add it to your Netlify environment variables and redeploy.",
        })),
      });
    }

    const results: Array<{ url: string; video?: Extracted; error?: string }> = [];
    for (const raw of urls as string[]) {
      const url = raw.trim();
      if (!getVideoId(url)) {
        results.push({ url, error: "Only valid HTTPS YouTube video URLs are accepted." });
        continue;
      }
      try {
        const video = await extract(url, apiKey);
        results.push({ url, video });
      } catch (error) {
        results.push({ url, error: error instanceof Error ? error.message : "Metadata lookup failed." });
      }
    }
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
}
