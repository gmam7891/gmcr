// Audience Authenticity Analysis Engine

export interface AuthenticityInput {
  streamerName: string;
  platform: string;
  avgViewers: number;
  peakViewers: number;
  streamDurationMinutes: number;
  totalMessages: number;
  uniqueChatters: number;
  messagesPerMinute: number;
  duplicateMessageRate: number;
  avgMessageLength: number;
  chatBurstiness: number;
  chatConsistencyScore: number;
  usernameSimilarityScore: number;
  newAccountActivityRate: number;
}

export interface AuthenticityAlert {
  title: string;
  description: string;
  level: "warning" | "critical";
}

export interface AuthenticityResult {
  viewerToChatRatio: number;
  engagementRate: number;
  spikeScore: number;
  spikeScoreNormalized: number;
  chatQualityScore: number;
  authenticityScore: number;
  classification: string;
  classificationColor: string;
  alerts: AuthenticityAlert[];
  insights: string[];
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function calculateAuthenticity(input: AuthenticityInput): AuthenticityResult {
  const {
    avgViewers, peakViewers, uniqueChatters, duplicateMessageRate,
    avgMessageLength, chatConsistencyScore, usernameSimilarityScore,
    chatBurstiness, newAccountActivityRate, totalMessages, messagesPerMinute,
  } = input;

  // 1. Viewer-to-Chat Ratio
  const viewerToChatRatio = avgViewers / Math.max(uniqueChatters, 1);

  // 2. Engagement Rate
  const engagementRate = uniqueChatters / Math.max(avgViewers, 1);

  // 3. Spike Detection Score
  const rawSpikeScore = (peakViewers - avgViewers) / Math.max(avgViewers, 1);
  const spikeScoreNormalized = clamp(rawSpikeScore * 50, 0, 100);

  // 4. Chat Quality Score
  const chatQualityScore = clamp(
    (chatConsistencyScore * 0.4) +
    ((100 - duplicateMessageRate) * 0.4) +
    (Math.min(avgMessageLength, 20) * 3) * 0.2,
    0, 100
  );

  // 5. Audience Authenticity Score (0-100)
  const rawEngagementComponent = clamp(engagementRate * 100, 0, 100) * 0.30;
  const chatQualityComponent = chatQualityScore * 0.25;
  const dupComponent = (100 - duplicateMessageRate) * 0.20;
  const spikeComponent = (100 - spikeScoreNormalized) * 0.15;
  const usernameComponent = (100 - usernameSimilarityScore) * 0.10;

  const authenticityScore = clamp(
    rawEngagementComponent + chatQualityComponent + dupComponent + spikeComponent + usernameComponent,
    0, 100
  );

  // Classification
  let classification: string;
  let classificationColor: string;
  if (authenticityScore >= 80) {
    classification = "Alta autenticidade";
    classificationColor = "accent";
  } else if (authenticityScore >= 60) {
    classification = "Boa, com leves inconsistências";
    classificationColor = "primary";
  } else if (authenticityScore >= 40) {
    classification = "Média, atenção recomendada";
    classificationColor = "warning";
  } else {
    classification = "Alta suspeita de audiência artificial";
    classificationColor = "destructive";
  }

  // Alerts
  const alerts: AuthenticityAlert[] = [];

  if (duplicateMessageRate > 25) {
    alerts.push({
      title: "Alta repetição de mensagens",
      description: `${duplicateMessageRate.toFixed(1)}% das mensagens são duplicadas — padrão comum em automação de chat.`,
      level: duplicateMessageRate > 50 ? "critical" : "warning",
    });
  }

  if (viewerToChatRatio > 100) {
    alerts.push({
      title: "Baixa proporção audiência/interação",
      description: `Ratio de ${viewerToChatRatio.toFixed(0)}:1 entre viewers e chatters — esperado abaixo de 50:1.`,
      level: "critical",
    });
  }

  if (rawSpikeScore > 1.5) {
    alerts.push({
      title: "Pico de audiência abrupto",
      description: `Peak ${((rawSpikeScore) * 100).toFixed(0)}% acima da média — pode indicar inflação pontual.`,
      level: rawSpikeScore > 3 ? "critical" : "warning",
    });
  }

  if (usernameSimilarityScore > 70) {
    alerts.push({
      title: "Padrão suspeito de usernames",
      description: `Score de similaridade de ${usernameSimilarityScore}% — usernames com padrões repetitivos.`,
      level: "critical",
    });
  }

  if (engagementRate < 0.02) {
    alerts.push({
      title: "Baixo nível de engajamento",
      description: `Apenas ${(engagementRate * 100).toFixed(2)}% dos viewers interagem no chat.`,
      level: engagementRate < 0.01 ? "critical" : "warning",
    });
  }

  if (newAccountActivityRate > 40) {
    alerts.push({
      title: "Alta presença de contas novas",
      description: `${newAccountActivityRate.toFixed(1)}% dos chatters são contas recentes.`,
      level: newAccountActivityRate > 60 ? "critical" : "warning",
    });
  }

  if (chatBurstiness > 80) {
    alerts.push({
      title: "Mensagens concentradas em picos",
      description: `Burstiness de ${chatBurstiness}% — mensagens muito concentradas em janelas curtas.`,
      level: "warning",
    });
  }

  // Insights (up to 3)
  const insights: string[] = [];

  if (authenticityScore >= 80) {
    insights.push("Engajamento consistente e proporcional sugere audiência orgânica e real.");
  }
  if (authenticityScore >= 60 && authenticityScore < 80) {
    insights.push("Audiência apresenta sinais majoritariamente orgânicos, com pequenas inconsistências que podem ser naturais.");
  }
  if (engagementRate < 0.02 && avgViewers > 500) {
    insights.push("Audiência com sinais de baixa interação orgânica — proporção viewer/chatter fora do esperado para o tamanho do canal.");
  }
  if (duplicateMessageRate > 30 && chatBurstiness > 60) {
    insights.push("Padrões indicam possível uso de automação no chat — alta repetição combinada com picos concentrados.");
  }
  if (usernameSimilarityScore > 60) {
    insights.push("Presença significativa de usernames com padrões similares — possível farm de contas.");
  }
  if (newAccountActivityRate > 50) {
    insights.push("Proporção elevada de contas novas no chat pode indicar audiência fabricada.");
  }
  if (rawSpikeScore > 2) {
    insights.push("Picos abruptos de audiência sem correlação com chat podem indicar view botting.");
  }

  return {
    viewerToChatRatio,
    engagementRate,
    spikeScore: rawSpikeScore,
    spikeScoreNormalized,
    chatQualityScore,
    authenticityScore: Math.round(authenticityScore),
    classification,
    classificationColor,
    alerts,
    insights: insights.slice(0, 3),
  };
}
