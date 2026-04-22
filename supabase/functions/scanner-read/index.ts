import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, handleRead, jsonResponse, READ_ACTIONS } from "../_shared/scanner-actions.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { supabase } = authResult;

  try {
    const body = await req.json();
    const { action } = body;
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
