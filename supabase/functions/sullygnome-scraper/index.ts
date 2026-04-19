import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY") || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { action, streamer_login, streamers } = await req.json();

    if (action === "scrape" && streamer_login) {
      const result = await scrapeSullyGnome(streamer_login);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "scrape_bulk" && Array.isArray(streamers)) {
      const results: Record<string, any> = {};
      // Process sequentially to avoid rate limits
      for (const login of streamers.slice(0, 10)) {
        try {
          results[login] = await scrapeSullyGnome(login);
        } catch (e: any) {
          results[login] = { error: e.message, gameStats: [] };
        }
      }
      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'scrape' with streamer_login or 'scrape_bulk' with streamers[]" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[SullyGnome] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function scrapeSullyGnome(streamerLogin: string) {
  if (!APIFY_API_KEY) throw new Error("APIFY_API_KEY not configured");

  const targetUrl = `https://sullygnome.com/channel/${streamerLogin}/30/games`;
  console.log(`[SullyGnome] Scraping: ${targetUrl}`);

  const actorId = "apify~web-scraper";
  const apiUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=120`;

  const pageFunction = `
    async function pageFunction(context) {
      const { $ } = context;
      const gameStats = [];
      $('#tblData tbody tr').each((i, el) => {
        gameStats.push({
          category: $(el).find('td:nth-child(2)').text().trim(),
          streamTime: $(el).find('td:nth-child(3)').text().trim(),
          avgViewers: $(el).find('td:nth-child(4)').text().trim(),
          percentage: $(el).find('td:nth-child(8)').text().trim()
        });
      });
      return { gameStats };
    }
  `;

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startUrls: [{ url: targetUrl }],
      pageFunction,
      proxyConfiguration: { useApifyProxy: true },
      maxRequestsPerCrawl: 1,
      maxConcurrency: 1,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[SullyGnome] Apify error ${res.status}:`, errText);
    throw new Error(`Apify web-scraper failed [${res.status}]`);
  }

  const items = await res.json();
  const gameStats = items?.[0]?.gameStats || [];

  // Parse numeric values
  const parsed = gameStats.map((g: any) => ({
    category: g.category || "Unknown",
    streamTimeRaw: g.streamTime || "0",
    streamTimeMinutes: parseStreamTime(g.streamTime || "0"),
    avgViewers: parseInt((g.avgViewers || "0").replace(/,/g, ""), 10) || 0,
    percentage: parseFloat((g.percentage || "0").replace("%", "")) || 0,
  }));

  // Identify casino-related categories
  const casinoKeywords = ["virtual casino", "slots", "casino", "just chatting", "gambling"];
  const casinoCategories = parsed.filter((g: any) =>
    casinoKeywords.some((kw) => g.category.toLowerCase().includes(kw))
  );

  const totalMinutes = parsed.reduce((sum: number, g: any) => sum + g.streamTimeMinutes, 0);
  const casinoMinutes = casinoCategories.reduce((sum: number, g: any) => sum + g.streamTimeMinutes, 0);

  return {
    streamer: streamerLogin,
    source: "sullygnome",
    period: "30d",
    gameStats: parsed,
    summary: {
      totalCategories: parsed.length,
      totalStreamMinutes: totalMinutes,
      casinoStreamMinutes: casinoMinutes,
      casinoPercentage: totalMinutes > 0 ? Math.round((casinoMinutes / totalMinutes) * 1000) / 10 : 0,
      topCategory: parsed[0]?.category || "N/A",
      casinoCategories: casinoCategories.map((c: any) => c.category),
    },
  };
}

function parseStreamTime(raw: string): number {
  // Formats: "12h 30m", "1d 5h 20m", "45m", "2h"
  let total = 0;
  const days = raw.match(/(\d+)d/);
  const hours = raw.match(/(\d+)h/);
  const mins = raw.match(/(\d+)m/);
  if (days) total += parseInt(days[1]) * 1440;
  if (hours) total += parseInt(hours[1]) * 60;
  if (mins) total += parseInt(mins[1]);
  // If pure number, treat as hours
  if (!days && !hours && !mins) {
    const n = parseInt(raw.replace(/,/g, ""), 10);
    if (!isNaN(n)) total = n * 60;
  }
  return total;
}
