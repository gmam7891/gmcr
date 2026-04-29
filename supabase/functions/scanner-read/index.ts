import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, getTwitchLiveStatusViaRapidAPI, handleRead, jsonResponse, READ_ACTIONS } from "../_shared/scanner-actions.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { supabase } = authResult;

  try {
    const body = await req.json();
    const { action } = body;
    if (action === "test_rapidapi_twitch") {
      const { login } = body;
      if (!login) {
        return new Response(
          JSON.stringify({ error: "login é obrigatório" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const status = await getTwitchLiveStatusViaRapidAPI(String(login));
      return new Response(
        JSON.stringify({ login, status, raw_secret_configured: !!Deno.env.get("RAPIDAPI_KEY") }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!READ_ACTIONS.has(action)) {
      return jsonResponse({ error: `Action '${action}' is not a read action` }, 400);
    }
    const result = await handleRead(supabase, body);
    if (result === null) return jsonResponse({ error: "Unknown read action: " + action }, 400);
    return jsonResponse(result);
  } catch (error: unknown) {
    console.error("scanner-read error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: msg }, 500);
  }
});
