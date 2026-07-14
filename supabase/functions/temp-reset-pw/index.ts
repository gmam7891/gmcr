import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const { email, password } = await req.json();
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // Paginate through auth users to find by email
    let found: any = null;
    for (let page = 1; page <= 20 && !found; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return new Response(JSON.stringify({ step: "list", error: JSON.stringify(error, Object.getOwnPropertyNames(error)) }), { status: 500 });
      found = data.users.find((u) => (u.email || "").toLowerCase() === String(email).toLowerCase());
      if (data.users.length < 200) break;
    }
    if (!found) return new Response(JSON.stringify({ error: "user not found" }), { status: 404 });
    const { data, error } = await admin.auth.admin.updateUserById(found.id, { password });
    if (error) return new Response(JSON.stringify({ step: "update", error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ ok: true, id: found.id, email: data.user?.email }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
});
