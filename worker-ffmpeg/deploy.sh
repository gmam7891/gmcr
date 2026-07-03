#!/usr/bin/env bash
# One-shot deploy to Fly.io. Requires: `fly` CLI logged in.
# Usage:
#   cd worker-ffmpeg && bash deploy.sh
set -euo pipefail

APP_NAME="${APP_NAME:-starklytic-ffmpeg}"
REGION="${REGION:-gru}"

if ! command -v fly >/dev/null 2>&1; then
  echo "❌ fly CLI não encontrado. Instale: https://fly.io/docs/hands-on/install-flyctl/"
  exit 1
fi

if ! fly auth whoami >/dev/null 2>&1; then
  echo "❌ Não logado no Fly. Rode: fly auth login"
  exit 1
fi

echo "▶ Criando app $APP_NAME (se ainda não existir)…"
fly apps create "$APP_NAME" --org personal 2>/dev/null || echo "  (app já existe, seguindo)"

TOKEN="$(openssl rand -hex 32)"
echo "▶ Configurando AUTH_TOKEN…"
fly secrets set --app "$APP_NAME" AUTH_TOKEN="$TOKEN" >/dev/null

echo "▶ Deploy…"
fly deploy --app "$APP_NAME" --region "$REGION" --now

URL="https://${APP_NAME}.fly.dev"
echo ""
echo "✅ Worker rodando em: $URL"
echo ""
echo "Agora, no Lovable Cloud, adicione dois secrets:"
echo "  FFMPEG_WORKER_URL   = $URL"
echo "  FFMPEG_WORKER_TOKEN = $TOKEN"
echo ""
echo "Teste rápido:"
echo "  curl $URL/health"
