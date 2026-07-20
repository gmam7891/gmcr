# Plano: alinhar VOD Analyzer do Starklytic ao VOD Audit Pro

Objetivo: substituir o pipeline atual (`twitch-api/analyze_vod_frames` + `vod-watcher-agent`) por uma cópia funcional do fluxo do VOD Audit Pro, mantendo compatibilidade com o resto do Starklytic (multi-org, RLS, tabela `raw_evidences`, timeline, exportações).

## O que muda no comportamento

1. **Storyboard**: passa a escolher automaticamente a variante de MAIOR resolução (`width*height`) do manifesto Twitch. Hoje pegamos a primeira.
2. **Prompt Gemini com imagens de referência**: cada jogo do closed-list envia até 3 thumbs da `game_visual_library` como `image_url` (data URL base64) no prompt, rotuladas `REFERENCE — <título> #N`. Este é o maior ganho de precisão.
3. **Modelo**: modo "alta precisão" muda de `gemini-2.5-flash` para `google/gemini-2.5-pro`. Modo rápido mantém Flash.
4. **Estratégias de detecção** (novo seletor na UI): `balanced` (default), `title_first`, `hud_first`, `aggressive_casino`.
5. **3 rótulos possíveis**: `<título exato>`, `OTHER_CASINO`, `UNIDENTIFIED` (hoje só temos título ou nada). `OTHER_CASINO` vira uma categoria contável separada.
6. **Fila persistida + claim atômico**: sprites vão pra coluna `pending_frames` (jsonb) na tabela de análise; RPC `claim_next_sprite` faz `UPDATE ... RETURNING` do primeiro item. Permite paralelizar múltiplos workers sem duplicar trabalho.
7. **Retry robusto no gateway**: 5 tentativas, backoff exponencial 1→8s + jitter ±30%, retry só em 429/5xx/524; se estourar marca frames como `UNIDENTIFIED` com motivo em vez de crashar.
8. **Diagnóstico rico**: contadores `sprites_downloaded/failed`, `frames_detected/other_casino/unidentified/low_confidence`, buckets `unidentified_reasons`, lista `missing_reference_thumbs`.

## O que NÃO muda

- Timeline oficial (`twitch-vod-chapters`) permanece igual.
- Modo "Todas as categorias" (chapters) permanece igual.
- Worker ffmpeg HD permanece como fallback opcional.
- `raw_evidences`, RLS, multi-org, exportações, UI dashboards continuam iguais.

## Mudanças de banco

Migration única:

```sql
-- Colunas novas em vod_audits (equivalente ao "analyses" do Audit Pro)
ALTER TABLE public.vod_audits
  ADD COLUMN IF NOT EXISTS pending_frames    jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS total_frames      integer,
  ADD COLUMN IF NOT EXISTS storyboard_variant text,
  ADD COLUMN IF NOT EXISTS detection_strategy text DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS diagnostics       jsonb DEFAULT '{}'::jsonb;

-- Categoria OTHER_CASINO em raw_evidences (já aceita string, sem migração de schema)

-- RPC para claim atômico
CREATE OR REPLACE FUNCTION public.claim_next_sprite(_audit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_sprite jsonb; BEGIN
  UPDATE public.vod_audits
     SET pending_frames = pending_frames - 0
   WHERE id = _audit_id
     AND jsonb_array_length(pending_frames) > 0
   RETURNING pending_frames->0 INTO v_sprite;
  RETURN v_sprite;
END $$;

-- RPC para aplicar delta de diagnóstico + progresso
CREATE OR REPLACE FUNCTION public.apply_chunk_result(_audit_id uuid, _delta jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ ... $$;
```

## Mudanças em edge functions

- **`twitch-api`** (ação `analyze_vod_frames`): refatorar para
  - escolher variante top-res,
  - baixar thumbs da `game_visual_library` (bucket `game-thumbnails`) e embutir como data URL,
  - montar prompt com 4 estratégias,
  - aceitar 3 rótulos,
  - retry 5x com backoff.
- **Novo `vod-audit-worker`** (substitui parte do `vod-watcher-agent`): loop `claim_next_sprite` → `analyze_vod_frames` → `apply_chunk_result` → finalize quando fila vazia.
- **`vod-watcher-agent`**: mantido só para modo "profundo" opcional; nova rota chama `vod-audit-worker`.

## Mudanças na UI (`VodTab.tsx` iGaming)

- Seletor de estratégia (`balanced | title_first | hud_first | aggressive_casino`).
- Card de diagnóstico mostrando: variante escolhida, sprites processados/falhos, frames detectados/`OTHER_CASINO`/`UNIDENTIFIED`, top 5 motivos de `UNIDENTIFIED`, jogos com thumb faltando.
- Barra de progresso baseada em `remaining_sprites / total_sprites`.

## Ordem de implementação

1. Migration (colunas + 2 RPCs + GRANTs).
2. Refactor `twitch-api/analyze_vod_frames` com prompt novo + refs + retry + 4 estratégias.
3. Nova edge `vod-audit-worker` com loop de claim.
4. UI: seletor de estratégia + painel de diagnóstico.
5. Teste ponta-a-ponta em 1 VOD real.

## Riscos / decisões

- **Custo**: Gemini Pro é ~3× Flash. Manter Flash como default e Pro só quando estratégia = `aggressive_casino` OU toggle "alta precisão".
- **Tamanho do prompt**: cap de 3 refs × N jogos pode estourar. Limitar a 40 jogos por chamada (chunk do closed-list).
- **Compatibilidade `raw_evidences`**: `OTHER_CASINO` entra como `game_name = 'OTHER_CASINO'` e é filtrado das métricas de exposição por provedor.

Se aprovar, executo tudo em sequência (migration + refactor + UI) na próxima resposta.