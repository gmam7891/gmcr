import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { authenticate, corsHeaders, handleWrite, jsonResponse, requireAdmin, WRITE_ACTIONS } from "../_shared/scanner-actions.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { userId, supabase } = authResult;

  // ALL writes require admin role
  const adminCheck = await requireAdmin(supabase, userId);
  if (adminCheck) return adminCheck;

  try {
    const body = await req.json();
    const { action } = body;
    if (!WRITE_ACTIONS.has(action)) {
      return jsonResponse({ error: `Action '${action}' is not a write action` }, 400);
    }
    const result = await handleWrite(supabase, body);
    if (result === null) return jsonResponse({ error: "Unknown write action: " + action }, 400);
    return jsonResponse(result);
  } catch (error: unknown) {
    console.error("scanner-write error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: msg }, 500);
  }
});
