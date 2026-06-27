// Supabase Edge Function: twitch-vod-chapters
// Fetches Twitch VOD chapter markers (category changes) via the unofficial GQL API
// and normalizes them into gap-free { game, startMs, endMs } segments.

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
// Public logged-out web client ID (same one twitch.tv uses for anonymous visitors).
const TWITCH_WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function extractVideoId(input: string): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/videos\/(\d+)/);
  return match ? match[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const videoId = extractVideoId(body.videoId ?? body.vodId ?? body.url ?? "");

    if (!videoId) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid videoId. Pass a numeric VOD id or a twitch.tv/videos/<id> URL." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const query = `
      query VodChapters($id: ID!) {
        video(id: $id) {
          id
          lengthSeconds
          moments(first: 100, momentRequestType: VIDEO_CHAPTER_MARKERS) {
            edges {
              node {
                description
                positionMilliseconds
                durationMilliseconds
                details {
                  ... on GameChangeMomentDetails {
                    game { id displayName }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const gqlRes = await fetch(TWITCH_GQL_URL, {
      method: "POST",
      headers: {
        "Client-ID": TWITCH_WEB_CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { id: videoId } }),
    });

    const gqlJson = await gqlRes.json();
    const video = gqlJson?.data?.video;

    if (!video) {
      return new Response(
        JSON.stringify({ error: "VOD not found, deleted, or unavailable.", videoId, gqlErrors: gqlJson?.errors ?? null }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const lengthMs = (video.lengthSeconds ?? 0) * 1000;

    const rawMoments = (video.moments?.edges ?? [])
      .map((e: any) => e?.node)
      .filter((n: any) => n && typeof n.positionMilliseconds === "number")
      .sort((a: any, b: any) => a.positionMilliseconds - b.positionMilliseconds);

    const segments = rawMoments.map((node: any, i: number) => {
      const startMs = node.positionMilliseconds;
      const nextStart = i + 1 < rawMoments.length ? rawMoments[i + 1].positionMilliseconds : lengthMs;
      const endMs = nextStart > startMs ? nextStart : lengthMs;
      return {
        game: node.details?.game?.displayName ?? node.description ?? null,
        gameId: node.details?.game?.id ?? null,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        reportedDurationMs: node.durationMilliseconds ?? null,
        source: "twitch_chapter",
      };
    });

    if (segments.length > 0 && segments[0].startMs > 0) {
      segments.unshift({
        game: null,
        gameId: null,
        startMs: 0,
        endMs: segments[0].startMs,
        durationMs: segments[0].startMs,
        reportedDurationMs: null,
        source: "twitch_chapter_implicit",
      });
    }

    return new Response(
      JSON.stringify({
        videoId: video.id,
        lengthMs,
        segmentCount: segments.length,
        hasChapters: rawMoments.length > 0,
        segments,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Unexpected error fetching VOD chapters.", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
