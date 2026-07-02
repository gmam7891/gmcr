// Starklytic ffmpeg worker — POST /scan
// Streams JPEG frames extracted directly from a remote HLS/DASH VOD URL,
// without downloading the full file. Frames come out as NDJSON:
//   { t: <seconds>, i: <index>, w, h, jpeg_b64 }
// One line per frame, flushed as soon as ffmpeg emits the SOI/EOI pair.
//
// Auth: if AUTH_TOKEN is set, requests must send `Authorization: Bearer <token>`.
// Env: PORT (default 8080), AUTH_TOKEN, MAX_DURATION_S (default 21600 = 6h).

import http from "node:http";
import { spawn } from "node:child_process";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const MAX_DURATION_S = Number(process.env.MAX_DURATION_S || 6 * 3600);

const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);

function isSafeUrl(u) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
    // Block private ranges (SSRF)
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/.test(url.hostname)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) return false;
    return true;
  } catch { return false; }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function bad(res, code, msg) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: msg }));
}

http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method !== "POST" || req.url !== "/scan") return bad(res, 404, "not found");

  if (AUTH_TOKEN) {
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${AUTH_TOKEN}`) return bad(res, 401, "unauthorized");
  }

  let body;
  try { body = await readJson(req); }
  catch { return bad(res, 400, "invalid json"); }

  const { vod_url, fps = 0.5, start, end, width = 640 } = body;
  if (!vod_url || !isSafeUrl(vod_url)) return bad(res, 400, "vod_url invalid");
  const fpsNum = Number(fps);
  if (!(fpsNum > 0 && fpsNum <= 10)) return bad(res, 400, "fps must be in (0, 10]");
  const w = Math.max(160, Math.min(1920, Number(width) || 640));

  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  if (start !== undefined) args.push("-ss", String(start));
  if (end !== undefined) {
    const dur = Math.max(0, Number(end) - Number(start || 0));
    if (dur > MAX_DURATION_S) return bad(res, 400, `duration exceeds ${MAX_DURATION_S}s`);
    args.push("-to", String(end));
  }
  args.push(
    "-i", vod_url,
    "-vf", `fps=${fpsNum},scale=${w}:-2`,
    "-q:v", "5",
    "-f", "image2pipe",
    "-vcodec", "mjpeg",
    "-",
  );

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  });

  const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  let buf = Buffer.alloc(0);
  let i = 0;
  const t0 = start !== undefined ? Number(start) : 0;

  ff.stdout.on("data", (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    // Emit each complete JPEG we can find in the buffer
    while (true) {
      const soi = buf.indexOf(JPEG_SOI);
      if (soi < 0) { buf = Buffer.alloc(0); break; }
      const eoi = buf.indexOf(JPEG_EOI, soi + 2);
      if (eoi < 0) { if (soi > 0) buf = buf.subarray(soi); break; }
      const jpeg = buf.subarray(soi, eoi + 2);
      buf = buf.subarray(eoi + 2);
      const line = JSON.stringify({
        t: +(t0 + i / fpsNum).toFixed(3),
        i,
        w,
        jpeg_b64: jpeg.toString("base64"),
      }) + "\n";
      res.write(line);
      i++;
    }
  });

  let stderr = "";
  ff.stderr.on("data", (d) => { stderr += d.toString("utf8"); });

  const cleanup = () => { try { ff.kill("SIGKILL"); } catch {} };
  req.on("close", cleanup);

  ff.on("close", (code) => {
    if (code !== 0 && !res.writableEnded) {
      res.write(JSON.stringify({ error: `ffmpeg exit ${code}`, stderr: stderr.slice(-2000) }) + "\n");
    }
    if (!res.writableEnded) {
      res.write(JSON.stringify({ done: true, frames: i }) + "\n");
      res.end();
    }
  });
}).listen(PORT, () => console.log(`ffmpeg worker listening on :${PORT}`));
