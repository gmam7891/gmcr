# Plano: Analista Virtual + Planejador de Campanha (com fundação multi-org)

## Visão geral

Você pediu **multi-org real** + **SQL livre validado**. Isso obriga 3 fases:
1. **Fundação multi-org** (sem isto, agente vaza dados entre clientes).
2. **Analista Virtual** (chat + relatório semanal).
3. **Planejador de Campanha** (matchmaking briefing → influencers).

Implementação sequencial, testando cada fase antes da próxima.

---

## Fase 1 — Fundação multi-org

Hoje só existe `profiles`, `user_roles`, `user_access`. Tudo escopado por `user_id`. Para multi-org real precisamos:

### Migration
- `organizations` (id, name, slug, created_at, owner_user_id)
- `organization_members` (org_id, user_id, role: owner/admin/member, created_at) — UNIQUE(org_id, user_id)
- `current_org_id` em `profiles` (org "ativa" do usuário)
- Função `get_user_org_ids(uuid)` SECURITY DEFINER (evita recursão RLS)
- Função `is_org_member(uuid, uuid)` SECURITY DEFINER
- GRANTs e RLS em ambas tabelas

### Decisão pragmática sobre tabelas existentes
As 28 tabelas atuais (vod_audits, discovery_prospects, stream_snapshots, casino_catalogs, etc.) **não têm `org_id`**. Adicionar coluna + backfill + nova RLS em todas é trabalho enorme e arriscado.

**Proposta**: começar com `org_id` **apenas nas tabelas que o Analista/Planejador lê** (vod_audits, discovery_prospects, stream_snapshots, monitored_streamers, agent_analyses) + tabelas novas (reports, campaigns). Backfill: todos os dados existentes vão pra uma org "default" do admin (você). Resto fica como está e a gente migra sob demanda.

### UI mínima
- Seletor de org no header (dropdown)
- Página `/admin` ganha aba "Organizações" pra criar org e convidar membros (admin only)
- `AuthContext` ganha `currentOrg`, `orgs`, `switchOrg()`

---

## Fase 2 — Analista Virtual

### Backend: edge function `ai-analyst`
Recebe `{ question }` + JWT do usuário.

**Fluxo:**
1. Resolver `org_id` ativa via `profiles.current_org_id` (validar membership).
2. **Geração SQL**: Gemini (`google/gemini-2.5-flash`) recebe schema-dictionary hardcoded (só as tabelas habilitadas + colunas seguras) + pergunta. Retorna SELECT puro.
3. **Validação rígida**:
   - Regex: deve começar com `SELECT` (case-insensitive, após trim)
   - Blacklist: `INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|--|/\*|;.*\S`
   - Whitelist de tabelas/views permitidas
   - Força `LIMIT 500` se ausente
   - **Força `WHERE org_id = '<uuid>'`** injetado no parser (não confia no LLM)
4. **Execução**: usar role read-only do Postgres via RPC `analyst_run_query(sql text)` SECURITY DEFINER que faz `SET LOCAL ROLE analyst_readonly` antes do EXECUTE.
5. **Resposta**: Gemini sintetiza resposta em PT-BR com os rows.
6. Retorna `{ answer, rows, sql }`.

### Backend: cron `weekly-report`
- Roda toda segunda 9h (pg_cron + pg_net).
- Para cada org ativa, roda set fixo de queries (top streamers, top jogos, novos influencers, delta vs semana anterior), Gemini gera resumo executivo.
- Salva em tabela nova `reports (org_id, week_start, summary_text, data jsonb)`.

### Frontend: nova aba "Analista"
- Adicionar `analyst` ao `allowed_tabs` no AuthContext
- Página com:
  - Chat (input + histórico de mensagens em estado local; sem persistência por enquanto)
  - Cada resposta: texto + tabela colapsável dos rows + accordion "ver SQL"
  - 3 perguntas-sugestão clicáveis
  - Aba lateral: histórico de relatórios semanais

---

## Fase 3 — Planejador de Campanha

### Backend: edge function `campaign-matchmaker`
Input: `{ budget, target_games[], target_providers[], region, objective, notes }`.

1. Query candidatos: `discovery_prospects` + cruzar com `vod_audits` (quem expôs target_games/providers historicamente) — escopado por `org_id`.
2. Para cada candidato calcular **score** (0-100):
   - 40% relevância (qtd segundos de exposição ao target nos últimos 90d)
   - 25% engajamento (eng_rate do discovery_prospects)
   - 20% alcance (viewer_minutes médio)
   - 15% aderência região/objetivo
3. **Alcance estimado** = avg(concurrent_viewers) × duração esperada da live (heurística: 4h)
4. **Faixa de custo** por tier:
   - Nano <10k seg: R$ 200-800
   - Micro 10-50k: R$ 800-3k
   - Mid 50-200k: R$ 3-15k
   - Macro 200k+: R$ 15-80k
   - Tiers editáveis em tabela `pricing_tiers (org_id, tier_name, min_followers, max_followers, min_price, max_price)`
5. Gemini gera justificativa curta (1-2 frases) por perfil contra o briefing.
6. "Encaixe orçamentário": greedy fit dos top N que cabem no budget.

### Tabela
- `campaigns (org_id, name, briefing jsonb, results jsonb, created_at, created_by)` para salvar/reusar briefings.

### Frontend: nova aba "Planejador"
- Formulário do briefing
- Resultado: header com "Com R$ X você consegue ~N perfis, alcance ~Y"
- Cards ranqueados (perfil, score, alcance, faixa custo, justificativa)
- Botão "Salvar campanha" e "Exportar Excel/PDF" (segue padrão do projeto)
- Botão "Gerar abordagem" desabilitado por enquanto (Fase 4 futura = agente #4)

---

## Detalhes técnicos importantes

### Multi-org sem refazer 28 tabelas
- Helper `get_org_scoped(table, org_id)` na edge function que sabe quais tabelas têm `org_id` e quais ainda usam global.
- Marcamos tabelas migradas em comentário SQL pra rastreio.

### Segurança SQL livre
- Role Postgres `analyst_readonly` com GRANT SELECT só em views específicas `analyst_v_*` (nunca tabela raw).
- Cada view já tem `WHERE org_id = current_setting('app.current_org_id')::uuid`.
- Edge function faz `SET LOCAL app.current_org_id = '<uuid>'` antes de rodar a query.
- Isso é **defense in depth**: mesmo se LLM injetar SQL malicioso e regex falhar, a view filtra.

### Modelo Gemini
- `google/gemini-2.5-flash` para SQL e síntese (rápido, barato, bom em estrutura).
- Sem streaming na v1 (relatório aguarda completar; chat retorna resposta inteira).

---

## Ordem de entrega

1. **Fase 1** (1 migration grande + UI seletor de org) → testar criação/troca de org
2. **Fase 2** (edge function + RPC + cron + aba Analista) → testar pergunta real
3. **Fase 3** (edge function + tabelas + aba Planejador) → testar briefing real

Cada fase eu paro e peço sua validação antes da próxima.

---

## O que NÃO está incluído

- Outreach Writer, Alertas, Compliance (agentes 3, 4, 5) — depois
- Migração das outras 23 tabelas pra `org_id` — sob demanda
- Convite de membros por email — começa só com `INSERT` manual via Admin
- Persistência de chat do Analista — v1 é só estado local
- Streaming de resposta — v1 retorna resposta completa
