import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/twitch';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) return jsonResponse({ error: 'LOVABLE_API_KEY not configured' }, 500);

  const TWITCH_API_KEY = Deno.env.get('TWITCH_API_KEY');
  if (!TWITCH_API_KEY) return jsonResponse({ error: 'TWITCH_API_KEY not configured' }, 500);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return jsonResponse({ error: 'Supabase config missing' }, 500);

  const twitchHeaders = {
    'Authorization': `Bearer ${LOVABLE_API_KEY}`,
    'X-Connection-Api-Key': TWITCH_API_KEY,
  };

  const supabaseHeaders = {
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'poll';

    // ─── POLL: fetch all active monitored streamers and record snapshots ───
    if (action === 'poll') {
      // Get active monitored streamers
      const streamersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/monitored_streamers?is_active=eq.true&select=login,display_name,twitch_id`,
        { headers: supabaseHeaders }
      );
      const streamers = await streamersRes.json();

      if (!Array.isArray(streamers) || streamers.length === 0) {
        return jsonResponse({ message: 'No active streamers to monitor', snapshots: 0 });
      }

      // Batch Twitch API calls (up to 100 per request)
      const logins = streamers.map((s: any) => s.login);
      const params = logins.map((l: string) => `user_login=${encodeURIComponent(l)}`).join('&');
      const streamsRes = await fetch(`${GATEWAY_URL}/streams?${params}&first=100`, { headers: twitchHeaders });
      const streamsData = await streamsRes.json();

      if (!streamsRes.ok) {
        throw new Error(`Twitch API error [${streamsRes.status}]: ${JSON.stringify(streamsData)}`);
      }

      const liveStreams = streamsData.data || [];
      const liveMap = new Map<string, any>();
      for (const s of liveStreams) {
        liveMap.set(s.user_login.toLowerCase(), s);
      }

      // Create snapshots for ALL monitored streamers
      const now = new Date().toISOString();
      const snapshots = logins.map((login: string) => {
        const stream = liveMap.get(login.toLowerCase());
        return {
          streamer_login: login,
          viewer_count: stream ? stream.viewer_count : 0,
          game_name: stream ? stream.game_name : null,
          game_id: stream ? stream.game_id : null,
          stream_title: stream ? stream.title : null,
          is_live: !!stream,
          captured_at: now,
        };
      });

      // Insert snapshots
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/stream_snapshots`, {
        method: 'POST',
        headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(snapshots),
      });

      if (!insertRes.ok) {
        const err = await insertRes.text();
        throw new Error(`Insert error: ${err}`);
      }

      return jsonResponse({
        message: `Polled ${logins.length} streamers, ${liveStreams.length} live`,
        snapshots: snapshots.length,
        live: liveStreams.length,
      });
    }

    // ─── ADD: add a streamer to monitor ───
    if (action === 'add_streamer') {
      const login = (body.login || '').toLowerCase().trim();
      if (!login) throw new Error('login is required');

      // Fetch user info from Twitch
      const userRes = await fetch(`${GATEWAY_URL}/users?login=${encodeURIComponent(login)}`, { headers: twitchHeaders });
      const userData = await userRes.json();
      if (!userRes.ok) throw new Error(`Twitch API error: ${JSON.stringify(userData)}`);

      const user = userData.data?.[0];
      if (!user) throw new Error(`User "${login}" not found on Twitch`);

      // Upsert into monitored_streamers
      const upsertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/monitored_streamers?on_conflict=login`,
        {
          method: 'POST',
          headers: { ...supabaseHeaders, 'Prefer': 'return=representation,resolution=merge-duplicates' },
          body: JSON.stringify({
            login: user.login,
            display_name: user.display_name,
            twitch_id: user.id,
            avatar_url: user.profile_image_url,
            is_active: true,
          }),
        }
      );

      const result = await upsertRes.json();
      return jsonResponse({ streamer: result[0] || result, user });
    }

    // ─── REMOVE: deactivate a streamer ───
    if (action === 'remove_streamer') {
      const login = (body.login || '').toLowerCase().trim();
      if (!login) throw new Error('login is required');

      await fetch(
        `${SUPABASE_URL}/rest/v1/monitored_streamers?login=eq.${encodeURIComponent(login)}`,
        {
          method: 'PATCH',
          headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ is_active: false }),
        }
      );

      return jsonResponse({ message: `${login} removed from monitoring` });
    }

    // ─── REACH: get aggregated reach data per game for a streamer ───
    if (action === 'get_reach') {
      const login = (body.login || '').toLowerCase().trim();
      const days = body.days || 30;
      const since = new Date(Date.now() - days * 86400000).toISOString();

      let url = `${SUPABASE_URL}/rest/v1/stream_snapshots?captured_at=gte.${since}&is_live=eq.true&select=streamer_login,viewer_count,game_name,captured_at&order=captured_at.asc&limit=10000`;
      if (login) {
        url += `&streamer_login=eq.${encodeURIComponent(login)}`;
      }

      const snapRes = await fetch(url, { headers: supabaseHeaders });
      const snapshots = await snapRes.json();

      // Aggregate: per game, calc avg viewers, total minutes, peak
      const gameMap = new Map<string, { game: string; totalViewerMinutes: number; count: number; peak: number; sumViewers: number }>();

      for (const snap of snapshots) {
        const game = snap.game_name || 'Unknown';
        const existing = gameMap.get(game);
        if (existing) {
          existing.count += 1;
          existing.sumViewers += snap.viewer_count;
          existing.totalViewerMinutes += snap.viewer_count * 2; // 2-min intervals
          existing.peak = Math.max(existing.peak, snap.viewer_count);
        } else {
          gameMap.set(game, {
            game,
            count: 1,
            sumViewers: snap.viewer_count,
            totalViewerMinutes: snap.viewer_count * 2,
            peak: snap.viewer_count,
          });
        }
      }

      const reachData = Array.from(gameMap.values())
        .map(g => ({
          game: g.game,
          avgViewers: Math.round(g.sumViewers / g.count),
          peakViewers: g.peak,
          totalMinutes: g.count * 2, // each snapshot = 2 min
          totalViewerMinutes: g.totalViewerMinutes,
          impressions: g.totalViewerMinutes, // viewer-minutes as impressions proxy
          snapshots: g.count,
        }))
        .sort((a, b) => b.totalViewerMinutes - a.totalViewerMinutes);

      return jsonResponse({ reach: reachData, totalSnapshots: snapshots.length, days });
    }

    // ─── LIST: list monitored streamers ───
    if (action === 'list_streamers') {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/monitored_streamers?is_active=eq.true&select=*&order=created_at.desc`,
        { headers: supabaseHeaders }
      );
      const data = await res.json();
      return jsonResponse({ streamers: data });
    }

    // ─── TIMELINE: viewer timeline for a streamer ───
    if (action === 'get_timeline') {
      const login = (body.login || '').toLowerCase().trim();
      if (!login) throw new Error('login is required');
      const hours = body.hours || 24;
      const since = new Date(Date.now() - hours * 3600000).toISOString();

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/stream_snapshots?streamer_login=eq.${encodeURIComponent(login)}&captured_at=gte.${since}&select=viewer_count,game_name,is_live,captured_at&order=captured_at.asc&limit=5000`,
        { headers: supabaseHeaders }
      );
      const data = await res.json();
      return jsonResponse({ timeline: data });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (error: unknown) {
    console.error('Stream monitor error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return jsonResponse({ error: msg }, 500);
  }
});
