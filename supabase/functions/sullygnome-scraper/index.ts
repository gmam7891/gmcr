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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, streamer_login, streamers, period } = await req.json();
    const days = normalizeDays(period);

    if (action === "scrape" && streamer_login) {
      const result = await scrapeSullyGnome(streamer_login, days);
      return json(result);
    }

    if (action === "scrape_bulk" && Array.isArray(streamers)) {
      const results: Record<string, any> = {};
      for (const login of streamers.slice(0, 10)) {
        try {
          results[login] = await scrapeSullyGnome(login, days);
        } catch (e: any) {
          results[login] = { error: e.message, gameStats: [] };
        }
      }
      return json({ results });
    }

    return json({ error: "Invalid action. Use 'scrape' or 'scrape_bulk'" }, 400);
  } catch (error: any) {
    console.error("[SullyGnome] Error:", error);
    return json({ error: error.message }, 500);
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

async function getChannelId(streamerLogin: string, days: number): Promise<string> {
  const url = `https://sullygnome.com/channel/${streamerLogin}/${days}/games`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Failed to load channel page [${res.status}]`);
  const html = await res.text();

  const patterns = [
    /\/api\/tables\/channelgames\/\d+\/(\d+)\//i,
    /data-(?:channel)?id=["'](\d+)["']/i,
    /(?:channelid|channel_id|channelId)\s*[=:]\s*["']?(\d+)["']?/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  throw new Error(`Could not extract channel ID for ${streamerLogin}`);
}

async function scrapeSullyGnome(streamerLogin: string, days: number) {
  console.log(`[SullyGnome] Scraping ${streamerLogin} (${days}d)`);
  const channelId = await getChannelId(streamerLogin, days);
  console.log(`[SullyGnome] channelId=${channelId}`);

  const apiUrl = `https://sullygnome.com/api/tables/channelgames/${days}/${channelId}/0/stream%20time/1/1/100/1`;
  const referer = `https://sullygnome.com/channel/${streamerLogin}/${days}/games`;

  const res = await fetch(apiUrl, {
    headers: {
      ...BROWSER_HEADERS,
      "X-Requested-With": "XMLHttpRequest",
      "Referer": referer,
      "Accept": "application/json, text/javascript, */*; q=0.01",
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`[SullyGnome] API error ${res.status}:`, txt.slice(0, 200));
    throw new Error(`SullyGnome API failed [${res.status}]`);
  }

  const payload = await res.json();
  const data: any[] = Array.isArray(payload?.data) ? payload.data : [];

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
