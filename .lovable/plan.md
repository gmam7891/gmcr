
# Catálogo de Cassinos → Visual Library (Piloto BullsBet)

Transformar as páginas de catálogo das casas (BullsBet primeiro) na fonte de verdade visual da `game_visual_library`. Cada tile do lobby vira: nome canônico + provedora + thumbnail oficial em alta + hash perceptual (pHash) pra matching determinístico contra frames de VOD.

## Arquitetura

```text
[URL da casa]
     │
     ▼
[edge: casino-catalog-scraper]──► Firecrawl scrape (HTML + links)
     │                                │
     │                                └─► extrai {name, provider, thumbnail_url}
     │                                    de cada tile (parser HTML)
     ▼
[storage: game-thumbnails/{casino}/{slug}.jpg]
     │
     ▼
[tabela: casino_catalog_thumbnails]  ◄── pHash 64-bit calculado server-side
     │
     ▼
[merge na game_visual_library]
     ├─ Match por nome normalizado → adiciona thumbnail como evidência
     └─ Sem match → cria entrada nova, dispara learn_game (Visual DNA da key art)
     │
     ▼
[intelligent-vod-agent] ──► quando vê tile no lobby:
                              1. recorta tile
                              2. calcula pHash
                              3. Hamming distance ≤ 10 → match determinístico
                              4. fallback: Visual DNA + Gemini (fluxo atual)
```

## Entregas

### 1. Migration: tabela `casino_catalog_thumbnails`

Colunas: `casino_slug`, `casino_name`, `game_name_raw`, `game_name_normalized`, `provider_name`, `thumbnail_url` (storage path), `source_page_url`, `phash` (`bytea`, 8 bytes), `game_library_id` (FK soft pra `game_visual_library`), `last_seen_at`, `metadata jsonb`.

Index único: `(casino_slug, game_name_normalized, provider_name)`. Index BRIN em `phash` pra busca por similaridade.

### 2. Migration: coluna `phash` em `game_visual_library`

Adiciona `thumbnail_phash bytea` e `thumbnails jsonb` (array de `{casino, url, phash, captured_at}`) — permite múltiplas thumbnails por jogo (cada casa tem variação leve).

### 3. Edge function `casino-catalog-scraper`

Actions:
- `scrape_casino { casino_slug, urls[] }` — chama Firecrawl, extrai tiles, baixa thumbnails, calcula pHash, upserta em `casino_catalog_thumbnails`. Tudo background-friendly (responde 202 + processa).
- `status { casino_slug }` — total, processados, pendentes, falhas.
- `merge_to_library { casino_slug }` — faz o casamento com `game_visual_library` e dispara `learn_game` pros novos.

pHash: implementação DCT 8x8 em Deno puro (sem dep nativa). Imagem reduzida a 32x32 grayscale → DCT → mediana dos 64 coefs de baixa frequência → bitmap.

Parser de tiles do BullsBet: lê HTML retornado pelo Firecrawl, busca `img` dentro de cards de jogo, extrai `alt`/`title`/legenda como `game_name`, detecta badge da provedora (`PG`, `Pragmatic`, etc.) por classe ou OCR leve do canto da imagem (Gemini Vision se a badge não estiver no DOM).

### 4. UI: aba "Catálogos" no `/scanner`

Componente novo `CasinoCatalogTab.tsx`:
- Input pra colar URL(s) do catálogo da casa + nome do casino.
- Botão "Importar catálogo" → chama `scrape_casino`.
- Tabela mostrando: jogo, provedora, thumbnail (preview 80×80), pHash (hex truncado), status (novo / casado com biblioteca / pendente DNA).
- Botão "Sincronizar com biblioteca" → chama `merge_to_library`.
- Card de progresso com polling de `status`.

### 5. Cron semanal

`pg_cron` job: toda segunda 04:00 BRT, chama `casino-catalog-scraper` com `action=scrape_casino` pra cada casa ativa na tabela `casino_catalogs` (tabela leve com lista de URLs gerenciada via UI). Insere via `supabase--insert` (não migration, contém URL/anon key).

### 6. Integração com `intelligent-vod-agent`

Adicionar passo no Modo Solo / Watcher antes de mandar pro Gemini:
- Pra cada tile recortado do mosaico, calcula pHash.
- Query: `SELECT game_library_id FROM casino_catalog_thumbnails WHERE bit_count(phash # $1) <= 10 ORDER BY bit_count(...) LIMIT 1`.
- Se match: outcome `promoted_by_phash`, confidence 0.98, pula chamada de Gemini → economia de custo + zero alucinação.
- Se não: fluxo atual (Gemini Vision com DNA).

Loga em `agent_detection_log` com novo outcome `promoted_by_phash` pra você medir taxa de acerto vs Gemini.

## Notas técnicas

- **Firecrawl já está conectado** (`FIRECRAWL_API_KEY` presente). Sem secret novo.
- **Storage**: criar bucket público `game-thumbnails` na mesma migration.
- **pHash em Postgres**: usar `bytea` + `bit_count(a # b)` (XOR + popcount). Funciona out-of-the-box no PG 14+.
- **Custo**: ~50 tiles por casa × 1 scrape Firecrawl ≈ 1 crédito Firecrawl/semana. Insignificante.
- **Sem pgvector** nesta versão. Se quisermos similaridade fuzzy de embeddings depois, adicionamos como camada extra.

## Fora do escopo do piloto

- Outras casas além de BullsBet (estrutura já pronta, só adicionar parsers).
- OCR do nome do jogo na thumbnail (usar só `alt`/`title` do DOM por enquanto).
- UI de revisão manual de duplicatas (jogo casado com nome errado) — mostro warning, correção fica pro V2.
