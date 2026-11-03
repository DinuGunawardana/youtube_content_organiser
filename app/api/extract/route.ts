import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const maxDuration = 60;

type Extracted = {
  id?: string; title?: string; thumbnail?: string;
  thumbnails?: Array<{url?: string; width?: number; height?: number}>;
  webpage_url?: string; original_url?: string; channel?: string; uploader?: string;
  duration?: number; upload_date?: string;
};

function allowed(raw: string) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return u.protocol === "https:" && [
      "youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com"
    ].includes(host);
  } catch { return false; }
}

function extract(url: string): Promise<Extracted> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", [
      "--dump-single-json", "--skip-download", "--no-warnings", "--no-playlist",
      "--no-call-home", "--socket-timeout", "15", url
    ], {shell: false});
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 25000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { out += chunk; if (out.length > 2_000_000) child.kill("SIGKILL"); });
    child.stderr.on("data", chunk => { err += chunk; if (err.length > 20000) err = err.slice(-20000); });
    child.on("error", e => {
      clearTimeout(timer);
      reject(new Error(e.message.includes("ENOENT") ? "yt-dlp is not installed on the server." : e.message));
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim().split("\n").slice(-2).join(" ") || `yt-dlp exited (${code})`));
      try { resolve(JSON.parse(out)); } catch { reject(new Error("Invalid metadata response from yt-dlp.")); }
    });
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const urls: unknown = body?.urls;
    if (!Array.isArray(urls) || urls.length < 1) return NextResponse.json({error: "Provide a list of URLs."}, {status: 400});
    if (urls.length > 100 || urls.some(u => typeof u !== "string" || u.length > 2048))
      return NextResponse.json({error: "Maximum 100 URLs per request."}, {status: 400});

    const results: Array<{url:string; video?:{
      id:string; title:string; thumbnail:string; url:string; channel:string;
      duration:number|null; uploadDate:string;
    }; error?:string}> = [];

    // Process in order. The client normally sends one URL per request so it
    // can update the import report after each link; this also protects callers
    // that submit multiple URLs in a single request.
    for (const raw of urls as string[]) {
      const url = raw.trim();
      if (!allowed(url)) {
        results.push({url, error: "Only HTTPS YouTube URLs are accepted."});
        continue;
      }
      try {
        const info = await extract(url);
        const thumbnail = info.thumbnail || [...(info.thumbnails || [])].sort((a,b)=>(b.width||0)-(a.width||0))[0]?.url;
        if (!info.id || !info.title || !thumbnail) throw new Error("Title, video ID or thumbnail unavailable.");
        results.push({url, video: {
          id: info.id, title: info.title, thumbnail,
          url: info.webpage_url || info.original_url || url,
          channel: info.channel || info.uploader || "",
          duration: info.duration ?? null, uploadDate: info.upload_date || ""
        }});
      } catch (e) {
        results.push({url, error: e instanceof Error ? e.message : "Extraction failed."});
      }
    }
    return NextResponse.json({results});
  } catch { return NextResponse.json({error: "Invalid request."}, {status: 400}); }
}
