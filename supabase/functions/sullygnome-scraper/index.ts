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
      const login = normalizeLogin(streamer_login);
      try {
        const result = await scrapeSullyGnome(login, days);
        return json(result);
      } catch (e: any) {
        console.error(`[SullyGnome] stage=${e.stage || "unknown"}:`, e.message);
        return json({
          error: e.message,
          stage: e.stage || "unknown",
          streamer: login,
          gameStats: [],
          summary: null,
        });
      }
    }

    if (action === "scrape_bulk" && Array.isArray(streamers)) {
      const results: Record<string, any> = {};
      for (const raw of streamers.slice(0, 10)) {
        const login = normalizeLogin(raw);
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

function normalizeLogin(input: unknown): string {
  let s = String(input ?? "").trim();
  // Strip protocol + host if user pasted a full URL
  s = s.replace(/^https?:\/\/[^/]+\//i, "");
  // Strip leading "channel/" (with or without slashes)
  s = s.replace(/^\/+/, "").replace(/^channel\/+/i, "");
  // Take only the first segment (drop /30/games, query, hash, etc.)
  s = s.split(/[/?#]/)[0];
  // Strip @ prefix if any (twitch-style handles)
  s = s.replace(/^@+/, "");
  return s.toLowerCase();
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
  // Strict: only real challenge / interstitial markers (not generic Cloudflare headers/refs)
  return /cf-browser-verification|cf-challenge|cf_chl_|\/cdn-cgi\/challenge-platform|just a moment\.\.\.|checking your browser before|attention required|enable javascript and cookies/i
    .test(html.slice(0, 8000));
}

async function smartFetch(
  url: string,
  headers: Record<string, string>,
  stage: string,
): Promise<string> {
  const isApi = url.includes("/api/");
  let directErr: any = null;
  try {
    const res = await fetch(url, { headers });
    console.log(`[smartFetch] direct ${url} -> ${res.status}`);
    if (res.ok) {
      const html = await res.text();
      if (isApi || !looksLikeCloudflareChallenge(html)) {
        console.log(`[smartFetch] direct OK (${html.length} bytes)`);
        return html;
      }
      console.log(`[smartFetch] direct 200 but Cloudflare challenge, falling back to Firecrawl`);
      directErr = new Error("Cloudflare challenge page");
    } else {
      directErr = new Error(`HTTP ${res.status}`);
    }
  } catch (e: any) {
    console.log(`[smartFetch] direct threw: ${e?.message}`);
    directErr = e;
  }

  if (isApi) {
    throw new StageError(stage, `Direct fetch failed for API endpoint: ${directErr?.message || "unknown"}`);
  }

  try {
    const html = await fetchViaFirecrawl(url, "rawHtml");
    console.log(`[smartFetch] firecrawl OK (${html.length} bytes)`);
    return html;
  } catch (fcErr: any) {
    if (fcErr instanceof StageError) throw fcErr;
    throw new StageError(stage, `Direct fetch and Firecrawl both failed: ${fcErr?.message || "unknown"}`);
  }
}

type ChannelHeader = {
  followers: string | null;
  status: string | null;
  mature: string | null;
  language: string | null;
  created: string | null;
  lastOnline: string | null;
  ranks: {
    peakViewer: { value: string | null; deltaSign: "up" | "down" | null; deltaValue: string | null };
    avgViewer: { value: string | null; deltaSign: "up" | "down" | null; deltaValue: string | null };
    follower: { value: string | null; deltaSign: "up" | "down" | null; deltaValue: string | null };
    followerGain: { value: string | null; deltaSign: "up" | "down" | null; deltaValue: string | null };
  };
};

type PeriodStat = {
  label: string;
  value: string;
  delta: string | null;
  deltaSign: "up" | "down" | null;
  deltaPct: string | null;
};

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function extractHeaderItem(html: string, label: string): string | null {
  const re = new RegExp(
    `>${label.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*<\\/div>\\s*<div[^>]*class=['"]MiddleSubHeaderItemValue['"][^>]*>([\\s\\S]*?)</div>`,
    "i",
  );
  const m = html.match(re);
  return m ? stripTags(m[1]) : null;
}

function extractRankItem(html: string, label: string) {
  const re = new RegExp(
    `>${label}:\\s*</div>\\s*<div[^>]*class=['"]MiddleSubHeaderItemValue['"][^>]*>([\\s\\S]*?)</div>\\s*</div>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return { value: null, deltaSign: null as null | "up" | "down", deltaValue: null };
  const inner = m[1];
  const valMatch = inner.match(/^([^<]+)/);
  const value = valMatch ? valMatch[1].trim() : null;
  const deltaSign: "up" | "down" | null = /angle-up/i.test(inner)
    ? "up"
    : /angle-down/i.test(inner)
    ? "down"
    : null;
  const deltaMatch = inner.match(/<\/div>\s*([^<()]+)\s*\)/);
  const deltaValue = deltaMatch ? deltaMatch[1].trim() : null;
  return { value, deltaSign, deltaValue };
}

function extractPeriodStat(html: string, label: string): PeriodStat | null {
  const re = new RegExp(
    `<h4[^>]*>${label}</h4>[\\s\\S]*?InfoStatPanelTLCell['"]>([^<]+)</div>[\\s\\S]*?InfoStatPanelBLCell\\s+(Positive|Negative)['"]>([^<]+)</div>[\\s\\S]*?InfoStatPanelTRCell\\s+(Positive|Negative)['"]>([\\s\\S]*?)</div>\\s*</div>\\s*</div>`,
    "i",
  );
  const m = html.match(re);
  if (!m) return null;
  const value = m[1].trim();
  const sign: "up" | "down" = m[2] === "Positive" ? "up" : "down";
  const delta = m[3].trim();
  const trBlock = m[5];
  const pctMatch = trBlock.match(/>([\d.]+%)</);
  return {
    label,
    value,
    delta,
    deltaSign: sign,
    deltaPct: pctMatch ? pctMatch[1] : null,
  };
}

function parseChannelHeader(html: string): ChannelHeader {
  return {
    followers: extractHeaderItem(html, "Followers"),
    status: extractHeaderItem(html, "Status"),
    mature: extractHeaderItem(html, "Mature"),
    language: extractHeaderItem(html, "Language"),
    created: extractHeaderItem(html, "Created"),
    lastOnline: extractHeaderItem(html, "Last online"),
    ranks: {
      peakViewer: extractRankItem(html, "Peak viewer rank"),
      avgViewer: extractRankItem(html, "Average viewer rank"),
      follower: extractRankItem(html, "Follower rank"),
      followerGain: extractRankItem(html, "Follower gain rank"),
    },
  };
}

function parsePeriodStats(html: string): PeriodStat[] {
  const labels = ["Average viewers", "Hours watched", "Followers gained", "Peak viewers", "Hours streamed", "Streams"];
  const out: PeriodStat[] = [];
  for (const l of labels) {
    const s = extractPeriodStat(html, l);
    if (s) out.push(s);
  }
  return out;
}

async function fetchStreams(
  streamerLogin: string,
  channelId: string,
  days: number,
  timecode: string,
): Promise<any[]> {
  const apiUrl = `https://sullygnome.com/api/tables/channeltables/streams/${days}/${channelId}/%20/1/1/desc/0/100`;
  const referer = `https://sullygnome.com/channel/${streamerLogin}/${days}/streams`;
  try {
    const res = await fetch(apiUrl, {
      headers: {
        ...BROWSER_HEADERS,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        ...(timecode ? { Timecode: timecode } : {}),
      },
    });
    if (!res.ok) {
      console.warn(`[fetchStreams] HTTP ${res.status}`);
      return [];
    }
    const parsed = await res.json();
    return Array.isArray(parsed?.data) ? parsed.data : [];
  } catch (e: any) {
    console.warn(`[fetchStreams] failed: ${e?.message}`);
    return [];
  }
}

async function getChannelInfo(
  streamerLogin: string,
  days: number,
): Promise<{ channelId: string; timecode: string; header: ChannelHeader; periodStats: PeriodStat[] }> {
  const url = `https://sullygnome.com/channel/${streamerLogin}`;
  const html = await smartFetch(url, BROWSER_HEADERS, "channel_page");

  const escapedLogin = streamerLogin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const idPatterns: RegExp[] = [
    new RegExp(`"${escapedLogin}"\\s*,\\s*"id"\\s*:\\s*(\\d+)`, "i"),
    /"id"\s*:\s*(\d+)\s*,\s*"name"\s*:\s*"[^"]+"\s*,\s*"logo"/i,
    /CreateChannelGames\(\s*['"][^'"]+['"]\s*,\s*['"][^'"]+['"]\s*,\s*\d+\s*,\s*['"][^'"]+['"]\s*,\s*['"](\d+)['"]/i,
    /\/api\/tables\/channel(?:games|tables\/games)\/\d+\/(\d+)\//i,
    /data-(?:channel)?id=["'](\d+)["']/i,
    /(?:channelid|channel_id|channelId)\s*[=:]\s*["']?(\d+)["']?/i,
  ];

  let channelId = "";
  for (const re of idPatterns) {
    const m = html.match(re);
    if (m?.[1]) {
      channelId = m[1];
      break;
    }
  }

  if (!channelId) {
    let reason = "page structure changed or channel ID not embedded in HTML";
    if (looksLikeCloudflareChallenge(html)) {
      reason = "page was a Cloudflare challenge (bot protection)";
    } else if (/not found|404|doesn't exist|page you requested/i.test(html.slice(0, 5000))) {
      reason = `channel "${streamerLogin}" does not exist on SullyGnome`;
    }
    console.log(`[getChannelInfo] no ID matched. HTML size=${html.length}. Snippet: ${html.slice(0, 500).replace(/\s+/g, " ")}`);
    throw new StageError("channel_id_not_found", `Could not extract SullyGnome channel ID: ${reason}`);
  }

  const tcMatch = html.match(/"timecode"\s*:\s*"([^"]+)"/);
  const timecode = tcMatch?.[1] || "";
  if (!timecode) {
    console.warn(`[getChannelInfo] timecode not found in HTML; API may reject the request`);
  }

  const header = parseChannelHeader(html);
  const periodStats = parsePeriodStats(html);
  return { channelId, timecode, header, periodStats };
}

async function fetchGameData(
  streamerLogin: string,
  channelId: string,
  days: number,
  timecode: string,
): Promise<any[]> {
  // New endpoint: /api/tables/channeltables/games/{days}/{channelId}/{extra}/{draw}/{orderCol}/{orderDir}/{start}/{length}
  const apiUrl = `https://sullygnome.com/api/tables/channeltables/games/${days}/${channelId}/%20/1/2/desc/0/100`;
  const referer = `https://sullygnome.com/channel/${streamerLogin}/${days}/games`;

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      headers: {
        ...BROWSER_HEADERS,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": referer,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        ...(timecode ? { Timecode: timecode } : {}),
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

function parseGamesPlayed(raw: unknown): { name: string; slug: string; logo: string } {
  if (typeof raw !== "string" || !raw) return { name: "Unknown", slug: "", logo: "" };
  const parts = raw.split("|");
  return { name: parts[0] || "Unknown", slug: parts[1] || "", logo: parts[2] || "" };
}

async function scrapeSullyGnome(streamerLogin: string, days: number) {
  console.log(`[SullyGnome] Scraping ${streamerLogin} (${days}d)`);
  const { channelId, timecode, header, periodStats } = await getChannelInfo(streamerLogin, days);
  console.log(`[SullyGnome] channelId=${channelId} tc=${timecode ? "yes" : "no"}`);

  const [data, streamsRaw] = await Promise.all([
    fetchGameData(streamerLogin, channelId, days, timecode),
    fetchStreams(streamerLogin, channelId, days, timecode),
  ]);

  const streams = streamsRaw.map((s: any) => ({
    streamId: s.streamId,
    startTime: s.starttime,
    startDateTime: s.startDateTime,
    endTime: s.endtime,
    lengthMinutes: Number(s.length) || 0,
    avgViewers: Number(s.avgviewers) || 0,
    peakViewers: Number(s.maxviewers) || 0,
    watchHours: Math.round((Number(s.viewminutes) || 0) / 60),
    followerGain: Number(s.followergain) || 0,
    games: typeof s.gamesplayed === "string"
      ? s.gamesplayed.split(",").map((g: string) => parseGamesPlayed(g.trim()))
      : [],
    streamUrl: s.streamUrl,
  }));

  const channelStreamMinutes = Number(data[0]?.channelstreamtime) || 0;

  const parsed = data.map((g) => {
    const game = parseGamesPlayed(g.gamesplayed);
    const streamMin = Number(g.streamtime) || 0;
    return {
      category: game.name,
      streamTimeRaw: minutesToHm(streamMin),
      streamTimeMinutes: streamMin,
      avgViewers: Number(g.avgviewers) || 0,
      peakViewers: Number(g.maxviewers) || 0,
      // viewtime = minutes * viewers; convert to hours watched
      hoursWatched: Math.round((Number(g.viewtime) || 0) / 60),
      streamsCount: 0, // not provided by new endpoint
      percentage:
        channelStreamMinutes > 0
          ? Math.round((streamMin / channelStreamMinutes) * 1000) / 10
          : 0,
      gamesId: undefined,
      gamesLogo: game.logo,
    };
  });

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
