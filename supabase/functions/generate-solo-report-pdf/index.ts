// ============================================================================
// generate-solo-report-pdf — gera PDF do relatório do MODO SOLO (leitura
// independente do agente de IA) no MESMO ESTILO do PDF de varredura
// (generate-audit-report-pdf): header escuro, cards de métricas, pie chart
// por provedora e tabela por jogo.
// ----------------------------------------------------------------------------
// Diferenças: fonte dos dados = tabela `agent_analyses` (modo solo), e o
// resumo executivo mostra concordância vs. pipeline.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
const BUCKET = "audit-reports";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtDuration(sec: number): string {
  if (!sec || sec < 0) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}m` : `${m}m`;
}

function pdfEscape(s: string): string {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function asciiSafe(s: string): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

function genColors(n: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const golden = 137.508;
  for (let i = 0; i < n; i++) {
    const h = (i * golden) % 360;
    out.push(hslToRgb(h, 65, 55));
  }
  return out;
}

interface SoloReport {
  vod_id: string;
  streamer_login: string;
  vod_duration_seconds: number;
  total_casino_seconds: number;
  summary: string;
  games: { game: string; provider: string; frames: number; seconds: number; avgConfidence: number }[];
  agree: number;
  diverge: number;
  avg_confidence: number;
  total_detections: number;
}

function buildPdf(report: SoloReport, signedExpiresAt: Date): Uint8Array {
  const provMap = new Map<string, number>();
  for (const g of report.games) {
    const key = (g.provider || "Desconhecido").trim() || "Desconhecido";
    provMap.set(key, (provMap.get(key) || 0) + (g.seconds || 0));
  }
  const provTotal = Array.from(provMap.values()).reduce((a, b) => a + b, 0) || 1;
  const providers = Array.from(provMap.entries())
    .map(([provider, seconds]) => ({ provider, seconds, pct: (seconds / provTotal) * 100 }))
    .sort((a, b) => b.seconds - a.seconds);

  const colors = genColors(providers.length);

  const PAGE_W = 595;
  const PAGE_H = 842;
  const MARGIN = 40;
  let cursorY = PAGE_H - MARGIN;

  const commands: string[] = [];

  function setFill(r: number, g: number, b: number) {
    commands.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
  }
  function setStroke(r: number, g: number, b: number) {
    commands.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
  }
  function rect(x: number, y: number, w: number, h: number, fill = true) {
    commands.push(`${x} ${y} ${w} ${h} re ${fill ? "f" : "S"}`);
  }
  function text(str: string, x: number, y: number, size = 10, bold = false) {
    const font = bold ? "/F2" : "/F1";
    commands.push(`BT ${font} ${size} Tf ${x} ${y} Td (${pdfEscape(asciiSafe(str))}) Tj ET`);
  }
  function line(x1: number, y1: number, x2: number, y2: number) {
    commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  }
  function pieSlice(cx: number, cy: number, r: number, startRad: number, endRad: number, color: [number, number, number]) {
    setFill(...color);
    const steps = Math.max(8, Math.ceil(((endRad - startRad) / (Math.PI * 2)) * 64));
    commands.push(`${cx} ${cy} m`);
    for (let i = 0; i <= steps; i++) {
      const t = startRad + ((endRad - startRad) * i) / steps;
      const x = cx + Math.cos(t) * r;
      const y = cy + Math.sin(t) * r;
      commands.push(`${x.toFixed(2)} ${y.toFixed(2)} l`);
    }
    commands.push(`h f`);
  }

  // ===== Header band =====
  setFill(0.07, 0.09, 0.15);
  rect(0, PAGE_H - 70, PAGE_W, 70);
  setFill(1, 1, 1);
  text("STARKLYTIC", MARGIN, PAGE_H - 30, 14, true);
  text("Relatorio - Modo Solo (Leitura do Agente de IA)", MARGIN, PAGE_H - 48, 11, false);
  text(new Date().toLocaleString("pt-BR"), PAGE_W - MARGIN - 110, PAGE_H - 30, 9);

  cursorY = PAGE_H - 95;

  setFill(0.1, 0.1, 0.1);
  text(`Streamer: @${report.streamer_login}`, MARGIN, cursorY, 11, true);
  cursorY -= 14;
  text(`VOD ID: ${report.vod_id}`, MARGIN, cursorY, 9);
  cursorY -= 12;
  text(`Validade do link: ate ${signedExpiresAt.toLocaleString("pt-BR")}`, MARGIN, cursorY, 8);
  cursorY -= 18;

  // ===== Summary box =====
  setFill(0.96, 0.97, 0.99);
  rect(MARGIN, cursorY - 60, PAGE_W - MARGIN * 2, 60);
  setFill(0.1, 0.1, 0.1);
  text("RESUMO EXECUTIVO (LEITURA INDEPENDENTE)", MARGIN + 10, cursorY - 14, 9, true);
  const summaryWords = asciiSafe(report.summary || "Sem dados.").split(/\s+/);
  const maxCharsPerLine = 95;
  const lines: string[] = [];
  let cur = "";
  for (const w of summaryWords) {
    if ((cur + " " + w).trim().length > maxCharsPerLine) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
    if (lines.length >= 3) break;
  }
  if (cur && lines.length < 3) lines.push(cur);
  let sy = cursorY - 28;
  for (const ln of lines) {
    text(ln, MARGIN + 10, sy, 8);
    sy -= 11;
  }
  cursorY -= 75;

  // ===== Metrics row =====
  const detectedPct = report.vod_duration_seconds > 0
    ? (report.total_casino_seconds / report.vod_duration_seconds) * 100
    : 0;
  const cards = [
    { label: "DETECCOES", value: String(report.total_detections) },
    { label: "TEMPO DETECTADO", value: fmtDuration(report.total_casino_seconds) },
    { label: "% DO STREAM", value: report.vod_duration_seconds > 0 ? `${detectedPct.toFixed(1)}%` : "—" },
    { label: "CONF. MEDIA", value: `${(report.avg_confidence * 100).toFixed(0)}%` },
  ];
  const cardW = (PAGE_W - MARGIN * 2 - 18) / 4;
  for (let i = 0; i < cards.length; i++) {
    const x = MARGIN + i * (cardW + 6);
    setFill(0.07, 0.09, 0.15);
    rect(x, cursorY - 50, cardW, 50);
    setFill(0.6, 0.65, 0.75);
    text(cards[i].label, x + 8, cursorY - 16, 7);
    setFill(1, 1, 1);
    text(cards[i].value, x + 8, cursorY - 36, 14, true);
  }
  cursorY -= 60;

  // Concordância row
  setFill(0.96, 0.97, 0.99);
  rect(MARGIN, cursorY - 22, PAGE_W - MARGIN * 2, 22);
  setFill(0.1, 0.1, 0.1);
  text(
    `Concorda com pipeline: ${report.agree}   |   Diverge: ${report.diverge}   |   Total: ${report.total_detections}`,
    MARGIN + 10,
    cursorY - 14,
    9,
    true,
  );
  cursorY -= 32;

  // ===== Pie + legend =====
  if (providers.length > 0) {
    setFill(0.1, 0.1, 0.1);
    text(`DISTRIBUICAO POR PROVEDORA (${providers.length})`, MARGIN, cursorY, 9, true);
    cursorY -= 12;

    const pieRadius = 70;
    const pieCx = MARGIN + pieRadius + 10;
    const pieCy = cursorY - pieRadius - 10;

    let angle = -Math.PI / 2;
    for (let i = 0; i < providers.length; i++) {
      const slice = (providers[i].seconds / provTotal) * Math.PI * 2;
      pieSlice(pieCx, pieCy, pieRadius, angle, angle + slice, colors[i]);
      angle += slice;
    }
    setFill(1, 1, 1);
    pieSlice(pieCx, pieCy, pieRadius * 0.45, 0, Math.PI * 2, [1, 1, 1]);

    const legendX = pieCx + pieRadius + 30;
    let legendY = cursorY - 18;
    const maxLegendItems = Math.min(providers.length, 13);
    for (let i = 0; i < maxLegendItems; i++) {
      const p = providers[i];
      setFill(...colors[i]);
      rect(legendX, legendY - 9, 9, 9);
      setFill(0.1, 0.1, 0.1);
      const labelTxt = p.provider.length > 28 ? p.provider.slice(0, 27) + "..." : p.provider;
      text(labelTxt, legendX + 14, legendY - 2, 8, true);
      setFill(0.4, 0.4, 0.45);
      text(`${fmtDuration(p.seconds)}  -  ${p.pct.toFixed(1)}%`, legendX + 14, legendY - 12, 7);
      legendY -= 24;
      if (legendY < cursorY - 2 * pieRadius - 20) break;
    }
    if (providers.length > maxLegendItems) {
      setFill(0.4, 0.4, 0.45);
      text(`+ ${providers.length - maxLegendItems} outras`, legendX + 14, legendY - 2, 7);
    }
    cursorY -= 2 * pieRadius + 30;
  }

  // ===== Per-game table =====
  if (report.games.length > 0) {
    setFill(0.1, 0.1, 0.1);
    text("DETECCAO POR JOGO", MARGIN, cursorY, 9, true);
    cursorY -= 14;

    setFill(0.93, 0.94, 0.97);
    rect(MARGIN, cursorY - 14, PAGE_W - MARGIN * 2, 14);
    setFill(0.1, 0.1, 0.1);
    text("JOGO", MARGIN + 8, cursorY - 10, 8, true);
    text("PROVEDORA", MARGIN + 220, cursorY - 10, 8, true);
    text("DETECCOES", MARGIN + 380, cursorY - 10, 8, true);
    text("TEMPO", MARGIN + 450, cursorY - 10, 8, true);
    cursorY -= 18;

    const maxRows = Math.min(report.games.length, Math.floor((cursorY - MARGIN - 30) / 12));
    for (let i = 0; i < maxRows; i++) {
      const g = report.games[i];
      if (i % 2 === 0) {
        setFill(0.98, 0.98, 0.99);
        rect(MARGIN, cursorY - 10, PAGE_W - MARGIN * 2, 12);
      }
      setFill(0.1, 0.1, 0.1);
      const gName = g.game.length > 32 ? g.game.slice(0, 31) + "..." : g.game;
      const gProv = (g.provider || "—").length > 24 ? g.provider.slice(0, 23) + "..." : (g.provider || "—");
      text(gName, MARGIN + 8, cursorY - 7, 8);
      setFill(0.4, 0.4, 0.45);
      text(gProv, MARGIN + 220, cursorY - 7, 8);
      text(String(g.frames), MARGIN + 380, cursorY - 7, 8);
      setFill(0.1, 0.1, 0.1);
      text(fmtDuration(g.seconds), MARGIN + 450, cursorY - 7, 8, true);
      cursorY -= 12;
    }
    if (report.games.length > maxRows) {
      setFill(0.4, 0.4, 0.45);
      text(`+ ${report.games.length - maxRows} jogos adicionais (visiveis no painel)`, MARGIN + 8, cursorY - 8, 7);
      cursorY -= 12;
    }
  }

  // Footer
  setStroke(0.85, 0.85, 0.88);
  line(MARGIN, MARGIN + 18, PAGE_W - MARGIN, MARGIN + 18);
  setFill(0.4, 0.4, 0.45);
  text("Fonte: agente de IA - Modo Solo (leitura independente)", MARGIN, MARGIN + 6, 7);
  text(`vod_id: ${report.vod_id}`, MARGIN, MARGIN - 6, 6);

  // ===== Assemble PDF =====
  const stream = commands.join("\n");
  const objects: string[] = [];
  function addObj(content: string): number {
    objects.push(content);
    return objects.length;
  }
  const fontHelv = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  const fontHelvBold = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`);
  const contentObj = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  const pageObj = addObj(
    `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentObj} 0 R ` +
    `/Resources << /Font << /F1 ${fontHelv} 0 R /F2 ${fontHelvBold} 0 R >> >> >>`,
  );
  const pagesObj = addObj(`<< /Type /Pages /Kids [${pageObj} 0 R] /Count 1 >>`);
  objects[pageObj - 1] = objects[pageObj - 1].replace("/Parent 0 0 R", `/Parent ${pagesObj} 0 R`);
  const catalogObj = addObj(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  let pdf = `%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n`;
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonResponse({ error: "Missing Authorization header" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const vodId = String(body?.vod_id || "");
    const streamerLogin = String(body?.streamer_login || "").trim() || "vod";
    const ttlSeconds = Math.min(
      Math.max(Number(body?.ttl_seconds) || DEFAULT_TTL_SECONDS, 60),
      60 * 60 * 24 * 30,
    );
    if (!vodId) return jsonResponse({ error: "vod_id is required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Pull analyses for VOD
    const { data: analyses, error: aErr } = await admin
      .from("agent_analyses")
      .select("*")
      .eq("vod_id", vodId)
      .order("start_seconds", { ascending: true });
    if (aErr) return jsonResponse({ error: aErr.message }, 500);
    if (!analyses || analyses.length === 0) {
      return jsonResponse({ error: "Nenhuma análise do agente para este VOD." }, 404);
    }

    // Try fetch VOD duration from twitch_vod_audits (best-effort)
    let vodDuration = 0;
    try {
      const { data: vodRow } = await admin
        .from("twitch_vod_audits")
        .select("vod_duration_seconds")
        .eq("vod_id", vodId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      vodDuration = Number(vodRow?.vod_duration_seconds || 0);
    } catch { /* ignore */ }

    // Aggregate per game
    const gameMap = new Map<string, { game: string; provider: string; frames: number; seconds: number; sumConf: number }>();
    let totalSec = 0;
    let sumConf = 0;
    let agree = 0;
    let diverge = 0;
    for (const a of analyses as any[]) {
      const dur = Number(a.duration_seconds || 0);
      totalSec += dur;
      sumConf += Number(a.confidence || 0);
      if (a.agrees_with_pipeline === true) agree++;
      else if (a.agrees_with_pipeline === false) diverge++;
      const key = `${a.game_name}||${a.provider_name || ""}`;
      const ex = gameMap.get(key);
      if (ex) {
        ex.frames += 1;
        ex.seconds += dur;
        ex.sumConf += Number(a.confidence || 0);
      } else {
        gameMap.set(key, {
          game: a.game_name,
          provider: a.provider_name || "",
          frames: 1,
          seconds: dur,
          sumConf: Number(a.confidence || 0),
        });
      }
    }
    const games = Array.from(gameMap.values())
      .map((g) => ({
        game: g.game,
        provider: g.provider,
        frames: g.frames,
        seconds: g.seconds,
        avgConfidence: g.frames > 0 ? g.sumConf / g.frames : 0,
      }))
      .sort((a, b) => b.seconds - a.seconds);

    const avgConf = analyses.length > 0 ? sumConf / analyses.length : 0;

    const summary = `Leitura independente do agente de IA detectou ${analyses.length} segmentos de cassino totalizando ${fmtDuration(totalSec)}` +
      (vodDuration > 0 ? ` (${((totalSec / vodDuration) * 100).toFixed(1)}% do stream)` : "") +
      `. Concordancia com pipeline principal: ${agree}/${analyses.length}.`;

    const report: SoloReport = {
      vod_id: vodId,
      streamer_login: streamerLogin,
      vod_duration_seconds: vodDuration,
      total_casino_seconds: totalSec,
      summary,
      games,
      agree,
      diverge,
      avg_confidence: avgConf,
      total_detections: analyses.length,
    };

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const pdfBytes = buildPdf(report, expiresAt);

    const path = `${streamerLogin}/solo-${vodId}-${Date.now()}.pdf`;
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) return jsonResponse({ error: `Upload falhou: ${upErr.message}` }, 500);

    const { data: signed, error: signErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, ttlSeconds, {
        download: `relatorio-solo-${streamerLogin}-${vodId}.pdf`,
      });
    if (signErr || !signed?.signedUrl) {
      return jsonResponse({ error: `Signed URL falhou: ${signErr?.message || "unknown"}` }, 500);
    }

    return jsonResponse({
      url: signed.signedUrl,
      path,
      expires_at: expiresAt.toISOString(),
      ttl_seconds: ttlSeconds,
      filename: `relatorio-solo-${streamerLogin}-${vodId}.pdf`,
      size_bytes: pdfBytes.byteLength,
    });
  } catch (err: any) {
    return jsonResponse({ error: err?.message || String(err) }, 500);
  }
});
