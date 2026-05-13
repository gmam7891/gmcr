const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
};

const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") || "";

class StageError extends Error {
  stage: string;
  constructor(stage: string, message: string) {
    super(message);
    this.stage = stage;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let streamerLogin = "";
  try {
    const { action, streamer_login, streamers, period } = await req.json();
    streamerLogin = streamer_login || "";
    const days = normalizeDays(period);

    if (action === "scrape" && streamer_login) {
      try {
        const result = await scrapeSullyGnome(streamer_login, days);
        return json(result);
      } catch (e: any) {
        console.error(`[SullyGnome] stage=${e.stage || "unknown"}:`, e.message);
        return json({
          error: e.message,
          stage: e.stage || "unknown",
          streamer: streamer_login,
          gameStats: [],
          summary: null,
        });
      }
    }

    if (action === "scrape_bulk" && Array.isArray(streamers)) {
      const results: Record<string, any> = {};
      for (const login of streamers.slice(0, 10)) {
        try {
          results[login] = await scrapeSullyGnome(login, days);
        } catch (e: any) {
          results[login] = {
            error: e.message,
            stage: e.stage || "unknown",
            gameStats: [],
            summary: null,
          };
        }
      }
      return json({ results });
    }

    return json({ error: "Invalid action. Use 'scrape' or 'scrape_bulk'", stage: "bad_request", gameStats: [], summary: null });
  } catch (error: any) {
    console.error("[SullyGnome] Top-level error:", error);
    return json({
      error: error.message,
      stage: "top_level",
      streamer: streamerLogin,
      gameStats: [],
      summary: null,
    });
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeDays(p: unknown): number {
  const n = Number(p);
  if ([7, 14, 30, 90, 365].includes(n)) return n;
  return 30;
}

async function fetchViaFirecrawl(url: string, format: string = "rawHtml"): Promise<string> {
  if (!FIRECRAWL_API_KEY) {
    throw new StageError("firecrawl_no_key", "FIRECRAWL_API_KEY not configured");
  }
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: [format],
      onlyMainContent: false,
      timeout: 30000,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new StageError("firecrawl_http", `Firecrawl returned ${res.status}: ${txt.slice(0, 200)}`);
  }
  const body = await res.json().catch(() => ({} as any));
  const content =
    body?.data?.rawHtml || body?.data?.html || body?.data?.content || body?.rawHtml || body?.html || "";
  if (!content) {
    throw new StageError("firecrawl_empty", "Firecrawl returned empty content");
  }
  return content;
}

function looksLikeCloudflareChallenge(html: string): boolean {
  return /cf-(browser-verification|chl|ray|challenge)|cloudflare|just a moment|checking your browser/i.test(
    html.slice(0, 8000),
  );
}

async function smartFetch(
  url: string,
  headers: Record<string, string>,
  stage: string,
): Promise<string> {
  const isApi = url.includes("/api/");
  let directErr: any = null;
  let directHtml: string | null = null;
  try {
    const res = await fetch(url, { headers });
    if (res.ok) {
      directHtml = await res.text();
      // For HTML pages, also detect Cloudflare challenge masquerading as 200
      if (isApi || !looksLikeCloudflareChallenge(directHtml)) {
        return directHtml;
      }
      console.log(`[smartFetch] Direct returned 200 but is a Cloudflare challenge, falling back to Firecrawl`);
      directErr = new Error("Cloudflare challenge page");
    } else {
      directErr = new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    directErr = e;
  }

  if (isApi) {
    throw new StageError(stage, `Direct fetch failed for API endpoint: ${directErr?.message || "unknown"}`);
  }

  // HTML fallback via Firecrawl
  try {
    return await fetchViaFirecrawl(url, "rawHtml");
  } catch (fcErr: any) {
    if (fcErr instanceof StageError) throw fcErr;
    throw new StageError(stage, `Direct fetch and Firecrawl both failed: ${fcErr?.message || "unknown"}`);
  }
}

async function getChannelId(streamerLogin: string, days: number): Promise<string> {
  const url = `https://sullygnome.com/channel/${streamerLogin}/${days}/games`;
  const html = await smartFetch(url, BROWSER_HEADERS, "channel_page");

  const patterns = [
    /\/api\/tables\/channelgames\/\d+\/(\d+)\//i,
    /data-(?:channel)?id=["'](\d+)["']/i,
    /(?:channelid|channel_id|channelId)\s*[=:]\s*["']?(\d+)["']?/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }

  // Diagnose why
  let reason = "page structure changed or channel ID not embedded in HTML";
  if (/cf-(browser-verification|chl|ray)|cloudflare/i.test(html)) {
    reason = "page was a Cloudflare challenge (bot protection)";
  } else if (/not found|404|doesn't exist|page you requested/i.test(html.slice(0, 5000))) {
    reason = `channel "${streamerLogin}" does not exist on SullyGnome`;
  }
  throw new StageError("channel_id_not_found", `Could not extract SullyGnome channel ID: ${reason}`);
}

async function fetchGameData(streamerLogin: string, channelId: string, days: number): Promise<any[]> {
  const apiUrl = `https://sullygnome.com/api/tables/channelgames/${days}/${channelId}/0/stream%20time/1/1/100/1`;
  const referer = `https://sullygnome.com/channel/${streamerLogin}/${days}/games`;

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      headers: {
        ...BROWSER_HEADERS,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer,
        "Accept": "application/json, text/javascript, */*; q=0.01",
      },
    });
  } catch (e: any) {
    throw new StageError("api_http", `API fetch threw: ${e?.message || "unknown"}`);
  }

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new StageError("api_http", `SullyGnome API returned ${res.status}: ${txt.slice(0, 200)}`);
  }

  let parsed: any;
  try {
    parsed = await res.json();
  } catch (e: any) {
    throw new StageError("api_not_json", `Failed to parse API response as JSON: ${e?.message || "unknown"}`);
  }

  if (!Array.isArray(parsed?.data)) {
    throw new StageError("api_bad_shape", `API response missing 'data' array (got ${typeof parsed?.data})`);
  }

  return parsed.data;
}

async function scrapeSullyGnome(streamerLogin: string, days: number) {
  console.log(`[SullyGnome] Scraping ${streamerLogin} (${days}d)`);
  const channelId = await getChannelId(streamerLogin, days);
  console.log(`[SullyGnome] channelId=${channelId}`);

  const data = await fetchGameData(streamerLogin, channelId, days);

  const parsed = data.map((g) => ({
    category: g.gamesName || "Unknown",
    streamTimeRaw: minutesToHm(g.streamtime || 0),
    streamTimeMinutes: g.streamtime || 0,
    avgViewers: g.averageviewers || 0,
    peakViewers: g.peakviewers || 0,
    hoursWatched: Math.round((g.hourswatched || 0) / 60),
    streamsCount: g.streams || 0,
    percentage: g.streamtimepercent || 0,
    gamesId: g.gamesId,
    gamesLogo: g.gamesLogo,
  }));

  const casinoKeywords = ["virtual casino", "slots", "casino", "gambling"];
  const casinoCategories = parsed.filter((g) =>
    casinoKeywords.some((kw) => g.category.toLowerCase().includes(kw))
  );

  const totalMinutes = parsed.reduce((s, g) => s + g.streamTimeMinutes, 0);
  const casinoMinutes = casinoCategories.reduce((s, g) => s + g.streamTimeMinutes, 0);
  const weightedAvg = parsed.reduce((s, g) => s + g.streamTimeMinutes * g.avgViewers, 0);
  const overallAvgViewers = totalMinutes > 0 ? Math.round(weightedAvg / totalMinutes) : 0;
  const overallPeakViewers = parsed.length > 0 ? Math.max(...parsed.map((g) => g.peakViewers)) : 0;
  const totalStreams = parsed.reduce((s, g) => s + g.streamsCount, 0);

  return {
    streamer: streamerLogin,
    channelId,
    source: "sullygnome",
    period: `${days}d`,
    gameStats: parsed,
    summary: {
      totalCategories: parsed.length,
      totalStreamMinutes: totalMinutes,
      casinoStreamMinutes: casinoMinutes,
      casinoPercentage:
        totalMinutes > 0 ? Math.round((casinoMinutes / totalMinutes) * 1000) / 10 : 0,
      topCategory: parsed[0]?.category || "N/A",
      casinoCategories: casinoCategories.map((c) => c.category),
      overallAvgViewers,
      overallPeakViewers,
      totalStreams,
    },
  };
}

function minutesToHm(m: number): string {
  if (!m) return "0m";
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mins}m`;
  return `${mins}m`;
}
