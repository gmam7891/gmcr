// LEGACY proxy: forwards to scanner-read or scanner-write based on action.
// Kept for backwards compat; new code should call scanner-read or scanner-write directly.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  authenticate, corsHeaders, handleRead, handleWrite, jsonResponse,
  READ_ACTIONS, WRITE_ACTIONS, requireAdmin,
} from "../_shared/scanner-actions.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { userId, supabase } = authResult;

  try {
    const body = await req.json();
    const { action } = body;

    if (READ_ACTIONS.has(action)) {
      const result = await handleRead(supabase, body);
      if (result === null) return jsonResponse({ error: "Unknown action: " + action }, 400);
      return jsonResponse(result);
    }

    if (WRITE_ACTIONS.has(action)) {
      const adminCheck = await requireAdmin(supabase, userId);
      if (adminCheck) return adminCheck;
      const result = await handleWrite(supabase, body);
      if (result === null) return jsonResponse({ error: "Unknown action: " + action }, 400);
      return jsonResponse(result);
    }

    return jsonResponse({ error: "Unknown action: " + action }, 400);
  } catch (error: unknown) {
    console.error("scanner-pipeline error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: msg }, 500);
  }
});
