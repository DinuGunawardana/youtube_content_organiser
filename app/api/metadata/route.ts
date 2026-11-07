import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Metadata = { title: string; thumbnail: string; platform: string; contentType: string };

function isPublicIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIP(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPublicIPv4(ip);
  if (version === 6) {
    const value = ip.toLowerCase().split("%")[0];
    // Only global-unicast IPv6 (2000::/3); this excludes loopback, link-local,
    // unique-local, IPv4-mapped, multicast and unspecified addresses.
    return /^[23][0-9a-f]{0,3}:/i.test(value);
  }
  return false;
}

async function resolvePublic(hostname: string): Promise<string> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Local network addresses are not supported.");
  const literalVersion = isIP(host);
  if (literalVersion) {
    if (!isPublicIP(host)) throw new Error("Private or reserved network addresses are not supported.");
    return host;
  }
  const records = await lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some(record => !isPublicIP(record.address))) throw new Error("The website does not resolve exclusively to public IP addresses.");
  return records[0].address;
}

function requestPublic(url: URL, redirectCount = 0): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string; finalUrl: string }> {
  return new Promise(async (resolve, reject) => {
    try {
      if (redirectCount > 3) throw new Error("Too many redirects while reading website metadata.");
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Only public HTTP and HTTPS pages are supported.");
      const ip = await resolvePublic(url.hostname);
      const client = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = client(url, {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ContentOrganiser/1.0; +https://example.com)", Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
        timeout: 7000,
        lookup: ((_hostname: string, _options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => callback(null, ip, isIP(ip))) as never,
      }, response => {
        const status = response.statusCode || 0;
        const location = response.headers.location;
        if ([301,302,303,307,308].includes(status) && location) {
          response.resume();
          const next = new URL(location, url);
          requestPublic(next, redirectCount + 1).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_000_000) { req.destroy(new Error("Website page is too large to inspect.")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks).toString("utf8"), finalUrl: url.toString() }));
      });
      req.on("timeout", () => req.destroy(new Error("Website metadata request timed out.")));
      req.on("error", reject);
      req.end();
    } catch (error) { reject(error); }
  });
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n))).replace(/&#x([\da-f]+);/gi, (_m, n) => String.fromCharCode(parseInt(n, 16))).trim();
}

function getMeta(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]+content\\s*=\\s*["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]+(?:property|name)\\s*=\\s*["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) { const match = html.match(pattern); if (match?.[1]) return decodeHtml(match[1]); }
  return "";
}

function identifyPlatform(inputUrl: URL): { platform: string; contentType: string } {
  const host = inputUrl.hostname.toLowerCase().replace(/^www\./, "");
  if (/(^|\.)instagram\.com$/.test(host)) return { platform: "Instagram", contentType: "Instagram link" };
  if (/(^|\.)(facebook\.com|fb\.watch)$/.test(host)) return { platform: "Facebook", contentType: "Facebook link" };
  if (/(^|\.)tiktok\.com$/.test(host)) return { platform: "TikTok", contentType: "TikTok link" };
  if (/(^|\.)linkedin\.com$/.test(host)) return { platform: "LinkedIn", contentType: "LinkedIn link" };
  if (/(^|\.)pinterest\.[a-z.]+$/.test(host)) return { platform: "Pinterest", contentType: "Pinterest link" };
  if (/(^|\.)(x\.com|twitter\.com)$/.test(host)) return { platform: "X / Twitter", contentType: "Social media link" };
  if (/(^|\.)(reddit\.com|redd\.it)$/.test(host)) return { platform: "Reddit", contentType: "Reddit link" };
  return { platform: host, contentType: /\/(article|articles|blog|news|story|stories)(\/|$)/i.test(inputUrl.pathname) || /\.(html?|php)$/i.test(inputUrl.pathname) ? "Article" : "Website link" };
}

async function tryOEmbed(url: string, platform: string): Promise<{ title?: string; thumbnail?: string }> {
  let endpoint: URL | null = null;
  if (platform === "TikTok") endpoint = new URL("https://www.tiktok.com/oembed");
  if (platform === "Reddit") endpoint = new URL("https://www.reddit.com/oembed");
  if (platform === "X / Twitter") endpoint = new URL("https://publish.twitter.com/oembed");
  if (!endpoint) return {};
  endpoint.searchParams.set("url", url);
  try {
    const response = await fetch(endpoint, { headers: { "User-Agent": "ContentOrganiser/1.0", Accept: "application/json" }, signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) return {};
    const data = await response.json() as { title?: string; author_name?: string; thumbnail_url?: string };
    return { title: data.title || undefined, thumbnail: data.thumbnail_url || undefined };
  } catch { return {}; }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const raw = body?.url;
    if (typeof raw !== "string" || raw.length > 2048) return NextResponse.json({ error: "Provide one URL no longer than 2048 characters." }, { status: 400 });
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname.includes(".")) return NextResponse.json({ error: "Only public HTTP and HTTPS URLs are supported." }, { status: 400 });
    const { platform, contentType } = identifyPlatform(url);
    const fallback = url.pathname.split("/").filter(Boolean).pop()?.replace(/[-_]+/g, " ") || url.hostname;
    let title = decodeHtml(fallback);
    let thumbnail = "";
    let metadataSource = "fallback";

    const embed = await tryOEmbed(url.toString(), platform);
    if (embed.title) { title = embed.title; metadataSource = "oEmbed"; }
    if (embed.thumbnail && /^https?:\/\//i.test(embed.thumbnail)) thumbnail = embed.thumbnail;

    try {
      const page = await requestPublic(url);
      const contentTypeHeader = String(page.headers["content-type"] || "");
      if (page.status >= 200 && page.status < 300 && /html|xhtml/i.test(contentTypeHeader)) {
        const html = page.body;
        const htmlTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
        const ogTitle = getMeta(html, "og:title") || getMeta(html, "twitter:title");
        const ogImage = getMeta(html, "og:image") || getMeta(html, "twitter:image") || getMeta(html, "twitter:image:src");
        const pageTitle = ogTitle || (htmlTitle ? decodeHtml(htmlTitle.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")) : "");
        if (pageTitle) { title = pageTitle; metadataSource = "Open Graph / page title"; }
        if (!thumbnail && ogImage) {
          try {
            const imageUrl = new URL(ogImage, page.finalUrl);
            if (["http:", "https:"].includes(imageUrl.protocol) && !imageUrl.username && !imageUrl.password) {
              await resolvePublic(imageUrl.hostname);
              thumbnail = imageUrl.toString();
            }
          } catch { /* ignore invalid or private-network preview images */ }
        }
      }
    } catch { /* Metadata is best-effort: the importer can still save the URL. */ }

    return NextResponse.json({ metadata: { title, thumbnail, platform, contentType } satisfies Metadata, metadataSource });
  } catch {
    return NextResponse.json({ error: "Invalid URL or metadata request." }, { status: 400 });
  }
}
