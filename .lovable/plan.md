## Plano: Agente Inteligente de Análise de VOD (Segunda Opinião + Aprendizado)

Incorpora o agente Python como um motor de **segunda opinião** que roda sob demanda em cima do pipeline atual, aprende automaticamente o perfil de cada jogo da Game Library via IA, e melhora com feedback do admin.

---

### 1. Banco de dados (estender o que já existe)

**`game_visual_library`** — adicionar colunas para aprendizado do agente:
- `agent_keywords TEXT[]` — palavras-chave que indicam o jogo (nome, símbolos, frases do HUD/paytable)
- `agent_visual_markers TEXT[]` — marcadores visuais (cores dominantes, elementos de UI únicos)
- `agent_confidence_threshold NUMERIC DEFAULT 0.70` — corte mínimo de confiança
- `agent_times_identified INTEGER DEFAULT 0`
- `agent_times_corrected INTEGER DEFAULT 0`
- `agent_average_confidence NUMERIC DEFAULT 0`
- `agent_last_identified_at TIMESTAMPTZ`
- `agent_learned_at TIMESTAMPTZ` — quando a IA gerou o perfil

**Nova tabela `agent_analyses`** — cada detecção do agente em um VOD:
- `id`, `vod_id`, `streamer_login`, `game_library_id` (FK), `game_name`, `provider_name`
- `start_seconds`, `end_seconds`, `duration_seconds`
- `confidence`, `keyword_confidence`, `visual_confidence`
- `agrees_with_pipeline BOOLEAN` — bate com a detecção do pipeline atual?
- `user_confirmed BOOLEAN`, `user_corrected BOOLEAN`, `feedback_at TIMESTAMPTZ`
- `created_at`

**Nova tabela `agent_feedback`** — correções do admin:
- `id`, `analysis_id` (FK), `original_game_id`, `corrected_game_id`, `correction_type` (`wrong_game | wrong_provider | false_positive | confirmed`), `notes`, `created_by`, `created_at`

Trigger: ao inserir feedback com `corrected_game_id`, incrementa `agent_times_corrected` do jogo errado e ajusta o threshold (sobe levemente após erros recorrentes).

RLS: leitura para autenticados, escrita só admin.

---

### 2. Edge function nova `intelligent-vod-agent`

Quatro actions:

| Action | O que faz |
|---|---|
| `learn_game` | Recebe `game_library_id`. Busca `visual_dna`, logo/HUD/paytable. Chama Lovable AI (Gemini Flash) com tool-calling pedindo `agent_keywords` (15-25 palavras) e `agent_visual_markers` (8-15 traços). Salva no banco e marca `agent_learned_at`. |
| `learn_all_pending` | Roda `learn_game` em lote para todos os jogos `trained` que ainda não têm `agent_learned_at`. |
| `analyze_vod` | Segunda opinião sob demanda. Recebe `vod_id`. Busca frames já analisados em `raw_evidences` (texto OCR + cores) **OU** re-analisa storyboards via Gemini Vision. Para cada janela de tempo, calcula confidence combinada (`60% keywords + 40% visual`) contra cada perfil aprendido, agrupa em blocos contínuos, salva em `agent_analyses` com `agrees_with_pipeline`. |
| `submit_feedback` | Recebe `analysis_id`, `corrected_game_id`, `correction_type`, `notes`. Insere em `agent_feedback`, atualiza estatísticas. |

---

### 3. Frontend — Integração em telas existentes

**Game Library (`GameLibraryTab.tsx`)** — em cada card expandido do jogo:
- Nova seção "🧠 Agente IA" mostrando: keywords aprendidas, visual markers, threshold, contadores (`identified`, `corrected`, `accuracy %`)
- Botão "Aprender / Re-aprender" que dispara `learn_game`
- No header da aba: botão "Treinar Agente em todos pendentes" (chama `learn_all_pending`)

**Audit (`AuditTab.tsx`) — detalhe do VOD**:
- Botão "🧠 Segunda opinião do Agente IA"
- Painel de comparação lado-a-lado: blocos do pipeline atual × blocos do agente, marcando 🟢 concordância / 🟡 divergência
- Em cada bloco do agente: botões `✓ Confirmar` / `✏ Corrigir jogo` (abre dropdown da Game Library) / `✗ Falso positivo`

---

### 4. Frontend — Nova aba `intel_agent` no Scanner

Adicionar em `opsTabs` (admin only): **"Agente IA"** com ícone `Brain`.

Dashboard contendo:
- KPIs: total de análises, total de correções, acurácia geral, jogos treinados pelo agente
- Top 10 jogos com melhor acurácia
- Top 10 jogos que mais geram correção (precisam re-treino)
- Fila de feedbacks recentes
- Botão "Treinar todos pendentes"

---

### 5. Arquivos a criar / modificar

| Arquivo | Ação |
|---|---|
| migração SQL | criar (colunas + 2 tabelas + RLS + trigger) |
| `supabase/functions/intelligent-vod-agent/index.ts` | criar |
| `supabase/config.toml` | adicionar bloco `[functions.intelligent-vod-agent] verify_jwt = false` |
| `src/lib/intelligent-agent-api.ts` | criar (wrappers `learnGame`, `analyzeVod`, `submitFeedback`, queries) |
| `src/components/scanner/GameLibraryTab.tsx` | editar — bloco Agente IA por jogo + botão batch |
| `src/components/scanner/AuditTab.tsx` | editar — botão segunda opinião + painel comparativo |
| `src/components/scanner/IntelAgentTab.tsx` | criar (dashboard) |
| `src/pages/Scanner.tsx` | editar — registrar tab `intel_agent` |
| `src/lib/translations.ts` | editar — strings PT/EN |

---

### Detalhes técnicos

- O agente **não substitui** o pipeline atual; ele lê/produz dados em paralelo, sempre comparando.
- Aprendizado da IA usa **structured output via tool-calling** (confiável), modelo `google/gemini-3-flash-preview` (custo baixo, alta qualidade para extração).
- Threshold inicial 0.70; ajuste automático: a cada 5 correções no mesmo jogo, threshold sobe 0.02 (até 0.95).
- `analyze_vod` reusa frames de `raw_evidences` quando disponíveis (não re-baixa thumbs) — apenas cruza texto/visual com perfis aprendidos.

Após sua aprovação, executo a migração primeiro (você confirma) e em seguida implemento edge function + UI.