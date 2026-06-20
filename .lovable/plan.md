## Objetivo

Adaptar o `vod-watcher-agent` para aplicar as regras do novo prompt (abstenção forte, `out_of_library`, `alternatives`, confiança calibrada 0–100, candidate list narrowed) **mantendo a arquitetura de mosaico**. A candidate list de cada VOD vem de uma detecção prévia no próprio VOD, não de chapters da Twitch.

## Fluxo novo (duas passadas no mesmo run)

```text
PASS 1 — Triagem (library inteira)
  └─ MOSAIC_PROMPT_BASE atual (sem mudanças grandes)
  └─ Processa ~20% dos mosaicos amostrados ao longo do VOD
  └─ Resultado: shortlist = {game_name → hits, confidence média}
       mantém quem aparece em ≥ N tiles OU com confidence ≥ 0.7 ao menos 1x
       sempre inclui top-K por contagem (K=8) como rede de segurança

PASS 2 — Detecção final (candidate list narrowed)
  └─ NOVO_MOSAIC_PROMPT com as regras do template
  └─ Processa 100% dos mosaicos com a shortlist como CANDIDATE LIST
  └─ Tiles fora da shortlist → out_of_library=true, game_name=null
  └─ Persistência temporal já existente continua aplicada sobre o resultado do Pass 2
```

A persistência temporal, threshold e timestamp anchoring continuam no agente, exatamente como hoje.

## Mudanças por arquivo

### `supabase/functions/vod-watcher-agent/index.ts`

1. **Constantes novas**
   - `CONF_THRESHOLD = 70` (0–100; o prompt continua emitindo 0–1, mas o gating do Pass 2 traduz `confidence*100` para a régua nova).
   - `PASS1_SAMPLE_RATIO = 0.2`, `SHORTLIST_MIN_HITS = 2`, `SHORTLIST_TOP_K = 8`.

2. **`MOSAIC_PROMPT_BASE` → divide em dois prompts**
   - `MOSAIC_PROMPT_TRIAGE` = prompt atual (renomeado), usado no Pass 1.
   - `MOSAIC_PROMPT_NARROWED` = nova versão incorporando as regras do template:
     - HARD RULES (1–5) reescritas em pt-BR.
     - Bloco "HOW TO IDENTIFY" (título → estrutura → DNA → confusable).
     - CONFIDENCE calibrada 0–100 mapeada para a saída 0–1 (>=0.90, 0.70–0.89, 0.40–0.69, <0.40) com a regra "abstém se < CONF_THRESHOLD/100".
     - Adiciona campos `out_of_library: boolean` e `alternatives: [{game_name, confidence}]` na saída.
     - Texto da CANDIDATE LIST injetado por `buildNarrowedMosaicPrompt(shortlist)` no formato `nome|provedora|palavras` (mesmo formato compacto de hoje, mas só com a shortlist).

3. **`SAVE_TILES_TOOL`** — acrescentar duas propriedades opcionais:
   - `out_of_library: { type: "boolean" }`
   - `alternatives: { type: "array", items: { type: "object", properties: { game_name: {type:["string","null"]}, confidence: {type:"number"} } } }`
   Sem quebrar tiles já gravados (campos opcionais, fallback `false`/`[]`).

4. **Orquestração no handler do chunk** (`processChunk` / loop principal)
   - Estado novo no `agent_runs` ou no próprio `audit.meta`: `pass1_done: boolean`, `shortlist: string[]`.
   - Se `pass1_done = false`: roda Pass 1 sobre mosaicos sampleados (cada N-ésimo, conforme `PASS1_SAMPLE_RATIO`). Não grava detecções finais ainda — só agrega `gameCounter` em memória/checkpoint.
   - Ao terminar amostragem: monta `shortlist` (regras acima), persiste em `audit.meta.shortlist`, marca `pass1_done=true`.
   - Pass 2 processa todos os mosaicos com `buildNarrowedMosaicPrompt(shortlist)`. Resultados alimentam o pipeline atual (validação contra `game_visual_library`, persistência temporal, blocos).
   - Tiles com `out_of_library=true` viram `screen_state="gameplay"`, `game_name=null` e entram em métrica `out_of_library_count` (apenas observabilidade, não geram bloco).

5. **Validação anti-alucinação existente (linha ~963)**
   - No Pass 2, fonte de verdade vira a **shortlist** (não a library inteira). Se o modelo devolver um nome fora da shortlist e `out_of_library=false`, downgrade para `null` + log de warning (mesmo padrão atual).

6. **Logs / observabilidade**
   - `[Watcher ${id}] Pass 1: amostrou X mosaicos, shortlist=[a,b,c]`
   - `[Watcher ${id}] Pass 2: Y tiles, Z out_of_library, W abaixo do threshold`

### Sem mudanças

- Schema de `vod_audits`, `detections`, `gameplay_blocks` (campos novos vivem em `audit.meta` JSONB e nos logs).
- Pipeline de persistência temporal, exposure_blocks e geração de relatório.
- Frontend (`VodAgentReadPanel`, `AuditReportCard`).

## Observações

- Custo: Pass 1 adiciona ~20% de chamadas. Pass 2 substitui o prompt atual (mesmo número de chamadas que hoje). Total ≈ +20% Gemini calls por VOD, em troca de candidate list narrowed real.
- Eval set continua sendo o próximo passo manual fora deste plano — `CONF_THRESHOLD` fica como constante facilmente ajustável no topo do arquivo.
- Se a shortlist sair vazia (VOD sem cassino claro nas amostras), Pass 2 é pulado e o audit termina com 0 detecções — mesma semântica de "VOD não-cassino" de hoje.

## Como vou verificar

- Lint/typecheck automático após o edit.
- `supabase--test_edge_functions` com um VOD curto já conhecido para conferir que (a) Pass 1 gera shortlist, (b) Pass 2 respeita ela, (c) `out_of_library_count` aparece nos logs.
