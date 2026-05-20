import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Connection": "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

const CASINO_KEYWORDS = ["virtual casino", "slots", "casino", "gambling"];
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") || "";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, streamer_login, streamers, period } = await req.json();
    const days = period || 30;

    if (action === "scrape" && streamer_login) {
      try {
        const result = await scrapeSullyGnome(streamer_login, days);
        return json(result);
      } catch (e: any) {
        console.error("[SullyGnome] scrape failed:", e);
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
          results[login] = { error: e.message, stage: e.stage, gameStats: [] };
        }
      }
      return json({ results });
    }

    return json(
      { error: "Invalid action. Use 'scrape' with streamer_login or 'scrape_bulk' with streamers[]" },
      400
    );
  } catch (error: any) {
    console.error("[SullyGnome] Fatal:", error);
    return json({ error: error.message }, 500);
  }
});

class StageError extends Error {
  stage: string;
  constructor(stage: string, message: string) {
    super(message);
    this.stage = stage;
  }
}

async function fetchViaFirecrawl(url: string, format: "html" | "rawHtml" = "rawHtml"): Promise<string> {
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
    const text = await res.text();
    throw new StageError("firecrawl_http", `Firecrawl returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const body = await res.json();
  const content = body?.data?.[format] || body?.data?.html || body?.data?.rawHtml || body?.data?.content;
  if (!content) {
    throw new StageError("firecrawl_empty", `Firecrawl returned no ${format} content`);
  }
  return content;
}

async function smartFetch(url: string, headers: Record<string, string>, stage: string): Promise<string> {
  try {
    console.log(`[SullyGnome] Direct fetch: ${url}`);
    const res = await fetch(url, { headers });
    if (res.ok) {
      return await res.text();
    }
    console.warn(`[SullyGnome] Direct fetch returned ${res.status}, falling back to Firecrawl`);
  } catch (e: any) {
    console.warn(`[SullyGnome] Direct fetch error: ${e.message}, falling back to Firecrawl`);
  }

  if (url.includes("/api/")) {
    throw new StageError(stage, `Direct fetch blocked for API endpoint ${url} (Firecrawl returns rendered HTML, not raw JSON)`);
  }

  try {
    return await fetchViaFirecrawl(url, "rawHtml");
  } catch (e: any) {
    throw new StageError(stage, `Both direct fetch and Firecrawl failed: ${e.message}`);
  }
}

async function getChannelId(streamerLogin: string): Promise<string> {
  const pageUrl = `https://sullygnome.com/channel/${encodeURIComponent(streamerLogin)}/30/games`;
  const html = await smartFetch(pageUrl, BROWSER_HEADERS, "channel_page");

  const patterns: Array<[string, RegExp]> = [
    ["ajax_url", /\/api\/tables\/channelgames\/\d+\/(\d+)\//],
    ["data_attr", /data-(?:channel)?id=["'](\d+)["']/i],
    ["js_var", /(?:channelid|channel_id|channelId)\s*[=:]\s*["']?(\d+)["']?/i],
  ];

  for (const [name, re] of patterns) {
    const m = html.match(re);
    if (m) {
      console.log(`[SullyGnome] Channel ID via ${name}: ${m[1]}`);
      return m[1];
    }
  }

  const isCloudflare = /cf-(browser-verification|chl|ray)|cloudflare/i.test(html);
  const isNotFound = /not found|404|doesn.t exist|page you requested/i.test(html.slice(0, 5000));
  const reason = isCloudflare
    ? "page was a Cloudflare challenge (bot protection)"
    : isNotFound
    ? `channel "${streamerLogin}" does not exist on SullyGnome`
    : "page structure changed or channel ID not embedded in HTML";

  throw new StageError("channel_id_not_found", `Could not extract SullyGnome channel ID: ${reason}`);
}

async function fetchGameData(channelId: string, streamerLogin: string, days: number): Promise<any[]> {
  const apiUrl = `https://sullygnome.com/api/tables/channelgames/${days}/${channelId}/0/stream%20time/1/1/100/1`;
  console.log(`[SullyGnome] Fetching game data: ${apiUrl}`);

  const res = await fetch(apiUrl, {
    headers: {
      ...BROWSER_HEADERS,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Referer": `https://sullygnome.com/channel/${encodeURIComponent(streamerLogin)}/${days}/games`,
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StageError("api_http", `SullyGnome API returned ${res.status}: ${body.slice(0, 200)}`);
  }

  let parsed: any;
  try {
    parsed = await res.json();
  } catch {
    throw new StageError("api_not_json", "SullyGnome API did not return JSON (likely Cloudflare block)");
  }

  if (!parsed?.data || !Array.isArray(parsed.data)) {
    throw new StageError("api_bad_shape", `Unexpected API response shape: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  return parsed.data;
}

async function scrapeSullyGnome(streamerLogin: string, days = 30) {
  const login = streamerLogin.toLowerCase().trim();
  const channelId = await getChannelId(login);
  const rawData = await fetchGameData(channelId, login, days);

  const parsed = rawData.map((g: any) => {
    const minutes = Number(g.streamtime) || 0;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return {
      category: g.gamesName || "Unknown",
      streamTimeRaw: h > 0 ? `${h}h ${m}m` : `${m}m`,
      streamTimeMinutes: minutes,
      avgViewers: Number(g.averageviewers) || 0,
      peakViewers: Number(g.peakviewers) || 0,
      hoursWatched: Math.round((Number(g.hourswatched) || 0) / 60),
      streamsCount: Number(g.streams) || 0,
      percentage: Number(g.streamtimepercent) || 0,
      gamesId: g.gamesId ?? null,
      gamesLogo: g.gamesLogo ?? null,
    };
  });

  const casinoRows = parsed.filter((g) =>
    CASINO_KEYWORDS.some((kw) => g.category.toLowerCase().includes(kw))
  );

  const totalMinutes = parsed.reduce((s, g) => s + g.streamTimeMinutes, 0);
  const casinoMinutes = casinoRows.reduce((s, g) => s + g.streamTimeMinutes, 0);
  const weightedViewers = parsed.reduce((s, g) => s + g.streamTimeMinutes * g.avgViewers, 0);
  const overallAvgViewers = totalMinutes > 0 ? Math.round(weightedViewers / totalMinutes) : 0;
  const overallPeakViewers = parsed.length > 0 ? Math.max(...parsed.map((g) => g.peakViewers)) : 0;
  const totalStreams = parsed.reduce((s, g) => s + g.streamsCount, 0);

  return {
    streamer: login,
    channelId,
    source: "sullygnome",
    period: `${days}d`,
    gameStats: parsed,
    summary: {
      totalCategories: parsed.length,
      totalStreamMinutes: totalMinutes,
      overallAvgViewers,
      overallPeakViewers,
      totalStreams,
      casinoStreamMinutes: casinoMinutes,
      casinoPercentage: totalMinutes > 0 ? Math.round((casinoMinutes / totalMinutes) * 1000) / 10 : 0,
      topCategory: parsed[0]?.category || "N/A",
      casinoCategories: casinoRows.map((c) => c.category),
    },
  };
}
