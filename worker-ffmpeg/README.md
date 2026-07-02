# Starklytic ffmpeg worker

Serviço HTTP mínimo que roda `ffmpeg` sobre a URL HLS/DASH remota de uma VOD
(sem baixar o arquivo) e devolve frames JPEG em stream NDJSON.

## Endpoints

- `GET /health` → `{ ok: true }`
- `POST /scan`
  - Header opcional: `Authorization: Bearer <AUTH_TOKEN>` (se `AUTH_TOKEN` configurado).
  - Body JSON:
    ```json
    {
      "vod_url": "https://.../index-dvr.m3u8",
      "fps": 0.5,          // frames por segundo (0 < fps ≤ 10)
      "start": 0,          // opcional, segundos
      "end": 600,          // opcional, segundos
      "width": 640         // opcional, largura em px (altura mantém proporção)
    }
    ```
  - Resposta: `application/x-ndjson`, uma linha por frame:
    ```json
    { "t": 1.5, "i": 0, "w": 640, "jpeg_b64": "..." }
    ```
    Última linha: `{ "done": true, "frames": N }`.

## Deploy

### Fly.io (recomendado, região `gru`)
```bash
cd worker-ffmpeg
fly launch --no-deploy --copy-config
fly secrets set AUTH_TOKEN=$(openssl rand -hex 32)
fly deploy
```

### Railway / Render / Cloud Run
Build a partir do `Dockerfile`. Exponha porta 8080. Defina `AUTH_TOKEN`.

## Ligar no Starklytic

Depois de deployar, adicione dois secrets no Lovable Cloud:
- `FFMPEG_WORKER_URL` = `https://starklytic-ffmpeg.fly.dev`
- `FFMPEG_WORKER_TOKEN` = mesmo valor de `AUTH_TOKEN`

A Edge Function `vod-scan-worker` já reconhece a ação `scan_ffmpeg` e faz proxy do stream.
