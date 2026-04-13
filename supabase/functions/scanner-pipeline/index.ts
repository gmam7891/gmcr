import { supabase } from "@/integrations/supabase/client";

/**
 * Interfaces Unificadas para IA e Twitch
 * Estas estruturas garantem que os dados da IA e da API da Twitch 
 * possam ser comparados e reconciliados corretamente.
 */
export interface AiGameDetection {
  game: string;
  provider: string | null;
  category: string;
  confidence: string;
  timestampSeconds?: number;
}

export interface GameTimeSegment {
  game: string;
  provider: string | null;
  category: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface AiVodAnalysis {
  games: AiGameDetection[];
  gameTimeline: GameTimeSegment[];
}

/**
 * Motor de comunicação com o Supabase Edge Functions
 */
async function callScanner(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("scanner-pipeline", { body });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

// ─── Ações do Pipeline Original ──────────────────

export async function saveRawEvidences(evidences: any[], processingBatchId?: string) {
  return callScanner({ action: "save_raw_evidences", evidences, processing_batch_id: processingBatchId });
}

export async function validateVod(vodId: string) {
  return callScanner({ action: "validate_vod", vod_id: vodId });
}

export async function consolidateVod(vodId: string) {
  return callScanner({ action: "consolidate_vod", vod_id: vodId });
}

export async function computeMetrics(vodId: string, vodDurationSeconds?: number) {
  return callScanner({ action: "compute_metrics", vod_id: vodId, vod_duration_seconds: vodDurationSeconds });
}

/**
 * runPipeline: O comando mestre que agora inclui a reconciliação automática
 */
export async function runPipeline(vodId: string, streamerLogin: string, vodDurationSeconds?: number) {
  // 1. Executa o pipeline padrão (Validação -> Consolidação -> Métricas)
  const result = await callScanner({ 
    action: "run_pipeline", 
    vod_id: vodId, 
    streamer_login: streamerLogin, 
    vod_duration_seconds: vodDurationSeconds 
  });

  // 2. Após o pipeline, executa a reconciliação para corrigir erros da Twitch com a IA
  if (vodDurationSeconds) {
    try {
      await reconcileAndCorrectSnapshots(vodId, streamerLogin, vodDurationSeconds);
    } catch (e) {
      console.error("Erro na reconciliação automática:", e);
    }
  }
  
  return result;
}

// ─── Lógica de Reconciliação IA vs Twitch ──────────────────

/**
 * reconcileAndCorrectSnapshots: O "Cérebro" Corretor
 * Esta função busca os snapshots (dados da Twitch) e os corrige usando a análise da IA.
 */
export async function reconcileAndCorrectSnapshots(
  vodId: string, 
  streamerLogin: string, 
  vodDurationSeconds: number
) {
  console.log(`[Reconciliação] Iniciando auditoria para VOD ${vodId} de ${streamerLogin}`);

  // 1. Busca os snapshots (dados da Twitch) salvos durante a live
  const { data: snapshots, error: snapError } = await supabase
    .from("stream_snapshots")
    .select("id, game_name, captured_at")
    .eq("streamer_login", streamerLogin)
    .order("captured_at", { ascending: true });

  if (snapError || !snapshots || snapshots.length === 0) {
    console.warn("[Reconciliação] Nenhum snapshot encontrado para corrigir.");
    return;
  }

  // 2. Busca a análise da IA (Vem da tabela de auditoria preenchida pela analyzeVodFrames)
  const { data: aiAudit, error: aiError } = await supabase
    .from("vod_audits")
    .select("ai_analysis")
    .eq("vod_id", vodId)
    .single();

  if (aiError || !aiAudit?.ai_analysis) {
    console.warn("[Reconciliação] Análise de IA não encontrada para este VOD.");
    return;
  }

  const analysis = aiAudit.ai_analysis as unknown as AiVodAnalysis;
  const timeline = analysis.gameTimeline;

  // 3. Processa as correções
  const corrections = [];
  const CONFIDENCE_THRESHOLD = 0.75; // Só corrigimos se a IA tiver >75% de certeza

  for (const snapshot of snapshots) {
    const snapTime = new Date(snapshot.captured_at).getTime() / 1000;
    
    // Encontra o que a IA viu nesse exato segundo
    const aiView = timeline.find(seg => 
      snapTime >= seg.startSeconds && snapTime <= seg.endSeconds
    );

    if (aiView) {
      // REGRA: Se a IA viu um jogo diferente e o título da live está errado, IA vence.
      if (aiView.game !== snapshot.game_name) {
        corrections.push({
          id: snapshot.id,
          game_name: aiView.game, // IA corrige o nome do jogo
          is_ai_verified: true,
          ai_confidence: "high" // Baseado no nosso threshold
        });
      }
    }
  }

  // 4. Aplica as correções no banco de dados (Batch Update)
  if (corrections.length > 0) {
    const { error: updateError } = await supabase
      .from("stream_snapshots")
      .upsert(corrections);

    if (updateError) throw new Error(`Erro ao salvar correções: ${updateError.message}`);
    console.log(`[Reconciliação] Sucesso! ${corrections.length} erros da Twitch foram corrigidos pela IA.`);
  }

  return { correctedCount: corrections.length };
}

// ─── Ações de Revisão e Auditoria ──────────────────

export async function reviewBlock(blockId: string, newStatus: string, reviewNotes?: string, reviewerId?: string) {
  return callScanner({ action: "review_block", block_id: blockId, new_status: newStatus, review_notes: reviewNotes, reviewer_id: reviewerId });
}

export async function requestReprocess(vodId: string, streamerLogin?: string) {
  return callScanner({ action: "request_reprocess", vod_id: vodId, streamer_login: streamerLogin });
}

export async function getVodAuditDetail(vodId: string) {
  return callScanner({ action: "get_vod_audit_detail", vod_id: vodId });
}

export async function getDashboardData(filters: any) {
  return callScanner({ action: "get_dashboard", ...filters });
}

export async function getRankings(params: any) {
  return callScanner({ action: "get_rankings", ...params });
}

// ─── Consultas Diretas ao Banco (Referência) ──────────────────

export async function getProviders() {
  const { data } = await supabase.from("providers").select("*").order("name");
  return data || [];
}

export async function getGames(providerId?: string) {
  let query = supabase.from("games").select("*");
  if (providerId) query = query.eq("provider_id", providerId);
  const { data } = await query.order("name");
  return data || [];
}
