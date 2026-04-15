import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROVIDER_PROFILES: Record<string, { focus: string; demoSites: string[] }> = {
  pg_soft: {
    focus: "Mobile-first vertical layouts, vibrant animated logos, 'Ways to Win' mechanics",
    demoSites: ["https://www.pgsoft.com/games", "https://www.pg-slot.net"],
  },
  games_global: {
    focus: "Artistic title screens, small corner provider logos, Slingshot/JFTW sub-studios",
    demoSites: ["https://www.gamesglobal.com/games"],
  },
  endorphina: {
    focus: "Minimalist European HUDs, clean paytable layouts, distinctive logo placement",
    demoSites: ["https://endorphina.com/games"],
  },
  pragmatic: {
    focus: "Buy Bonus buttons, high-volatility HUDs, Pragmatic logo bottom-right",
    demoSites: ["https://www.pragmaticplay.com/en/slots"],
  },
  amusnet: {
    focus: "Classic slot layouts, EGT-style interfaces, small provider badge",
    demoSites: ["https://amusnetinteractive.com/en/games"],
  },
  nolimit: {
    focus: "High-volatility xWays/xBet mechanics, distinctive Nolimit logo, dark themes",
    demoSites: ["https://www.nolimitcity.com/games"],
  },
  tada: {
    focus: "Mobile/vertical layouts similar to PG Soft, Asian-themed vibrant graphics",
    demoSites: [],
  },
  caleta: {
    focus: "Brazilian-themed artistic titles, colorful HUDs, Caleta corner logo",
    demoSites: ["https://www.caletagaming.com/games"],
  },
  hacksaw: {
    focus: "Pixel-art style, distinctive Hacksaw logo, high-volatility indicators",
    demoSites: ["https://www.hacksawgaming.com/games"],
  },
  evolution: {
    focus: "Live Casino interfaces, dealer/presenter frames, Evolution logo overlay",
    demoSites: ["https://www.evolution.com/games"],
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apifyKey = Deno.env.get("APIFY_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    if (!lovableKey) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify admin
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) throw new Error("Unauthorized");
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      if (!roles?.some(r => r.role === "admin")) throw new Error("Admin only");
    }

    const { action, ...payload } = await req.json();

    if (action === "list_providers") {
      return new Response(JSON.stringify(
        Object.entries(PROVIDER_PROFILES).map(([slug, p]) => ({
          slug,
          focus: p.focus,
          demoSites: p.demoSites,
        }))
      ), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "scrape_and_train") {
      const { source_url, provider_slug, game_name_hint } = payload;
      if (!source_url || !provider_slug) throw new Error("source_url and provider_slug required");

      const profile = PROVIDER_PROFILES[provider_slug];
      if (!profile) throw new Error(`Unknown provider: ${provider_slug}`);

      // Update status to processing
      const existingCheck = game_name_hint
        ? await supabase.from("game_visual_library").select("id").eq("game_name", game_name_hint).eq("provider_slug", provider_slug).maybeSingle()
        : null;

      let recordId: string;
      if (existingCheck?.data?.id) {
        recordId = existingCheck.data.id;
        await supabase.from("game_visual_library").update({
          training_status: "processing",
          source_url,
          error_message: null,
        }).eq("id", recordId);
      } else {
        const { data: inserted, error: insertErr } = await supabase.from("game_visual_library").insert({
          game_name: game_name_hint || "Unknown Game",
          provider_name: provider_slug.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          provider_slug,
          source_url,
          training_status: "processing",
        }).select("id").single();
        if (insertErr) throw insertErr;
        recordId = inserted.id;
      }

      // Step 1: Use Apify to capture screenshots
      let screenshots: { logo?: string; hud?: string; paytable?: string; pageTitle?: string } = {};

      if (apifyKey) {
        try {
          screenshots = await captureWithApify(apifyKey, source_url, provider_slug);
        } catch (e) {
          console.error("[SCRAPPER] Apify capture failed:", e);
          // Continue without screenshots - AI will work with URL only
        }
      }

      // Step 2: Upload screenshots to storage
      const ALLOWED_SCREENSHOT_KEYS = ["logo", "hud", "paytable"];
      const uploadedUrls: Record<string, string> = {};
      for (const [key, base64] of Object.entries(screenshots)) {
        if (!base64 || typeof base64 !== "string" || !ALLOWED_SCREENSHOT_KEYS.includes(key)) continue;
        try {
          const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const path = `${provider_slug}/${recordId}/${key}.png`;
          const { error: uploadErr } = await supabase.storage.from("game-references").upload(path, buffer, {
            contentType: "image/png",
            upsert: true,
          });
          if (!uploadErr) {
            const { data: urlData } = supabase.storage.from("game-references").getPublicUrl(path);
            uploadedUrls[`${key}_url`] = urlData.publicUrl;
          }
        } catch (e) {
          console.error(`[SCRAPPER] Upload ${key} failed:`, e);
        }
      }

      // Step 3: Generate Visual DNA with AI
      const visualDna = await generateVisualDNA(lovableKey, {
        gameName: game_name_hint || screenshots.pageTitle || "Unknown",
        providerSlug: provider_slug,
        providerFocus: profile.focus,
        sourceUrl: source_url,
        hasScreenshots: Object.keys(uploadedUrls).length > 0,
      });

      // Step 4: Update record
      const gameName = game_name_hint || screenshots.pageTitle || visualDna.detected_game_name || "Unknown Game";
      const { error: updateErr } = await supabase.from("game_visual_library").update({
        game_name: gameName,
        visual_dna: visualDna,
        training_status: "trained",
        ...uploadedUrls,
        metadata: {
          page_title: screenshots.pageTitle,
          scraped_at: new Date().toISOString(),
          has_screenshots: Object.keys(uploadedUrls).length > 0,
        },
      }).eq("id", recordId);

      if (updateErr) throw updateErr;

      console.log(`[SCRAPPER] ✅ Trained: ${gameName} (${provider_slug})`);

      return new Response(JSON.stringify({
        success: true,
        id: recordId,
        game_name: gameName,
        visual_dna: visualDna,
        screenshots: uploadedUrls,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "list_library") {
      const { data, error } = await supabase
        .from("game_visual_library")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete_entry") {
      const { id } = payload;
      if (!id) throw new Error("id required");
      const { error } = await supabase.from("game_visual_library").delete().eq("id", id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "bulk_import") {
      const { games } = payload;
      if (!Array.isArray(games) || games.length === 0) throw new Error("games array required");
      if (games.length > 500) throw new Error("Maximum 500 games per import");

      // Fetch existing games for dedup
      const { data: existing } = await supabase
        .from("game_visual_library")
        .select("game_name, provider_slug");
      const existingSet = new Set(
        (existing || []).map(e => `${e.game_name.toLowerCase()}|${e.provider_slug.toLowerCase()}`)
      );

      const results: Array<{ game_name: string; provider: string; status: string; error?: string }> = [];
      const toInsert: Array<{ game_name: string; provider_name: string; provider_slug: string; source_url: string | null; training_status: string }> = [];
      const insertMap: Array<{ game_name: string; provider: string }> = [];

      for (const game of games) {
        const { game_name, provider, url } = game;
        if (!game_name) {
          results.push({ game_name: game_name || "?", provider: provider || "?", status: "error", error: "Missing name" });
          continue;
        }

        const providerSlug = provider
          ? provider.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
          : "unknown";

        const key = `${game_name.toLowerCase()}|${providerSlug}`;
        if (existingSet.has(key)) {
          results.push({ game_name, provider, status: "duplicate" });
          continue;
        }

        existingSet.add(key);
        const providerName = provider || providerSlug.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        toInsert.push({
          game_name,
          provider_name: providerName,
          provider_slug: providerSlug,
          source_url: url || null,
          training_status: "pending",
        });
        insertMap.push({ game_name, provider });
      }

      // Batch insert in chunks of 500
      const CHUNK = 500;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK);
        const map = insertMap.slice(i, i + CHUNK);
        const { error: insertErr } = await supabase.from("game_visual_library").upsert(chunk, { onConflict: "game_name,provider_slug", ignoreDuplicates: true });
        if (insertErr) {
          for (const m of map) results.push({ ...m, status: "error", error: insertErr.message });
        } else {
          for (const m of map) results.push({ ...m, status: "done" });
        }
      }

      const imported = results.filter(r => r.status === "done").length;
      const duplicates = results.filter(r => r.status === "duplicate").length;
      const errors = results.filter(r => r.status === "error").length;

      console.log(`[SCRAPPER] Bulk import: ${imported} new, ${duplicates} dups, ${errors} errors`);

      return new Response(JSON.stringify({
        success: true,
        results,
        summary: { imported, duplicates, errors, total: games.length },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e: any) {
    console.error("[SCRAPPER] Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function captureWithApify(apiKey: string, url: string, providerSlug: string): Promise<any> {
  // Use Apify's web scraper to navigate, accept modals, and capture screenshots
  const input = {
    startUrls: [{ url }],
    runMode: "DEVELOPMENT",
    pageFunction: `async function pageFunction(context) {
      const { page, request } = context;
      
      // Wait for page load
      await page.waitForTimeout(5000);
      
      // Try to accept age verification / cookie modals
      const modalSelectors = [
        'button:has-text("18+")', 'button:has-text("I am 18")', 'button:has-text("Tenho 18")',
        'button:has-text("Accept")', 'button:has-text("Aceitar")', 'button:has-text("OK")',
        'button:has-text("Continue")', 'button:has-text("Continuar")',
        'button:has-text("I agree")', 'button:has-text("Concordo")',
        '[class*="cookie"] button', '[class*="modal"] button[class*="accept"]',
        '[class*="age"] button', '[data-testid="age-gate-confirm"]',
      ];
      
      for (const sel of modalSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) { await btn.click(); await page.waitForTimeout(1000); }
        } catch {}
      }
      
      await page.waitForTimeout(3000);
      
      // Capture full page screenshot
      const screenshot = await page.screenshot({ fullPage: false, type: 'png' });
      const title = await page.title();
      
      return {
        pageTitle: title,
        hud: screenshot.toString('base64'),
      };
    }`,
    maxPagesPerCrawl: 1,
    preNavigationHooks: `[
      async ({ page }) => {
        await page.setViewportSize({ width: 1920, height: 1080 });
      }
    ]`,
  };

  // Run Apify actor
  const runResponse = await fetch(
    `https://api.apify.com/v2/acts/apify~web-scraper/runs?token=${apiKey}&waitForFinish=120`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  if (!runResponse.ok) {
    const txt = await runResponse.text();
    throw new Error(`Apify run failed [${runResponse.status}]: ${txt}`);
  }

  const runData = await runResponse.json();
  const datasetId = runData.data?.defaultDatasetId;

  if (!datasetId) throw new Error("No dataset from Apify run");

  // Fetch results
  const resultsResponse = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}`
  );

  if (!resultsResponse.ok) throw new Error("Failed to fetch Apify results");

  const results = await resultsResponse.json();
  return results[0] || {};
}

async function generateVisualDNA(
  apiKey: string,
  ctx: {
    gameName: string;
    providerSlug: string;
    providerFocus: string;
    sourceUrl: string;
    hasScreenshots: boolean;
  }
): Promise<any> {
  const prompt = `You are an iGaming visual forensics expert. Generate a VISUAL DNA profile for detecting this game in live streams.

GAME: "${ctx.gameName}"
PROVIDER: ${ctx.providerSlug.replace(/_/g, " ")}
PROVIDER VISUAL FOCUS: ${ctx.providerFocus}
SOURCE URL: ${ctx.sourceUrl}

Generate a JSON object with these fields:
1. "detected_game_name": The official game title
2. "provider_canonical": The canonical provider name
3. "unique_visual_traits": Array of 3-5 specific visual characteristics for stream detection:
   - Logo position and style
   - Button colors and shapes (Spin, Buy Bonus, etc.)
   - Balance display format and position
   - Background theme/color palette
   - Any distinctive UI elements
4. "hud_layout": Object describing { "spin_button_position", "balance_position", "logo_position", "paytable_access" }
5. "color_palette": Array of 3-5 dominant hex colors
6. "detection_keywords": Array of text strings that might appear on screen (game title, provider name, etc.)
7. "volatility_indicators": Any visual cues about game volatility (Buy Bonus, xWays, Megaways, etc.)
8. "browser_title_pattern": Expected browser tab title pattern when this game is played

Return ONLY valid JSON, no markdown.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are an iGaming visual analysis expert. Return only valid JSON." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error("AI rate limited, try again later");
    if (response.status === 402) throw new Error("AI credits exhausted");
    throw new Error(`AI gateway error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  try {
    // Strip markdown code fences if present
    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { raw_response: content, parse_error: true };
  }
}
