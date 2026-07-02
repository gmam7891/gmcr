# Small, ffmpeg-enabled Node runtime.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev || true
COPY server.js ./

ENV PORT=8080
EXPOSE 8080

# Non-root
RUN useradd -m -u 10001 worker
USER worker

CMD ["node", "server.js"]
