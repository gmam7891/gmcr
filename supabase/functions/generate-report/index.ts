import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple PDF generator using raw PDF spec (no external libs needed)
function generatePdf(data: any): Uint8Array {
  const lines: string[] = [];
  const objects: string[] = [];
  let objCount = 0;

  function addObj(content: string): number {
    objCount++;
    objects.push(`${objCount} 0 obj\n${content}\nendobj`);
    return objCount;
  }

  // Build content stream
  const {
    influencer, baseScenario, baseResults, simScenario, simResults,
    baseIvs, simIvs, fairPrice, targetRoi,
  } = data;

  const contentLines = [
    `BT`,
    `/F1 18 Tf 50 780 Td (VALUATION PRO - Relatorio de Analise) Tj`,
    `/F1 10 Tf 0 -30 Td (Influenciador: ${influencer || 'N/A'}) Tj`,
    `0 -25 Td (Data: ${new Date().toLocaleDateString('pt-BR')}) Tj`,
    ``,
    `0 -35 Td /F1 14 Tf (INFLUENCER VALUE SCORE \\(IVS\\)) Tj`,
    `/F1 11 Tf 0 -22 Td (Score Base: ${baseIvs?.total || 0}/100 - ${baseIvs?.classification || 'N/A'}) Tj`,
    `0 -18 Td (Score Simulado: ${simIvs?.total || 0}/100 - ${simIvs?.classification || 'N/A'}) Tj`,
    `0 -18 Td (Risco: ${baseIvs?.riskLabel || 'N/A'}) Tj`,
    ``,
    `0 -30 Td /F1 14 Tf (CENARIO BASE) Tj`,
    `/F1 10 Tf 0 -20 Td (Fee: R$ ${baseScenario?.fee?.toLocaleString('pt-BR') || '0'}) Tj`,
    `0 -16 Td (CTR: ${baseScenario?.ctr || 0}%  |  CVR: ${baseScenario?.cvr || 0}%  |  ICP: ${baseScenario?.percIcp || 0}%) Tj`,
    `0 -16 Td (Valor FTD: R$ ${baseScenario?.valueFtd || 0}) Tj`,
    `0 -16 Td (Receita: R$ ${baseResults?.revenue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0'}) Tj`,
    `0 -16 Td (ROI: ${baseResults?.roi?.toFixed(1) || '0'}%) Tj`,
    `0 -16 Td (CPA: R$ ${baseResults?.cpa?.toFixed(2) || 'N/A'}) Tj`,
    `0 -16 Td (Lucro: R$ ${baseResults?.profit?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0'}) Tj`,
    ``,
    `0 -30 Td /F1 14 Tf (CENARIO SIMULADO) Tj`,
    `/F1 10 Tf 0 -20 Td (Fee: R$ ${simScenario?.fee?.toLocaleString('pt-BR') || '0'}) Tj`,
    `0 -16 Td (CTR: ${simScenario?.ctr || 0}%  |  CVR: ${simScenario?.cvr || 0}%  |  ICP: ${simScenario?.percIcp || 0}%) Tj`,
    `0 -16 Td (Receita: R$ ${simResults?.revenue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0'}) Tj`,
    `0 -16 Td (ROI: ${simResults?.roi?.toFixed(1) || '0'}%) Tj`,
    `0 -16 Td (Lucro: R$ ${simResults?.profit?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0'}) Tj`,
    ``,
    `0 -30 Td /F1 14 Tf (RECOMENDACAO DE PRECO JUSTO) Tj`,
    `/F1 10 Tf 0 -20 Td (ROI Alvo: ${targetRoi || 300}%) Tj`,
    `0 -16 Td (Faixa recomendada: R$ ${fairPrice?.min?.toLocaleString('pt-BR') || '0'} - R$ ${fairPrice?.max?.toLocaleString('pt-BR') || '0'}) Tj`,
    ``,
    `0 -30 Td /F1 14 Tf (COMPOSICAO DO SCORE) Tj`,
    `/F1 10 Tf 0 -20 Td (ROI: ${baseIvs?.pillars?.roi || 0}/25  |  ICP Match: ${baseIvs?.pillars?.icpMatch || 0}/20  |  Consistencia: ${baseIvs?.pillars?.consistency || 0}/20) Tj`,
    `0 -16 Td (Conversao: ${baseIvs?.pillars?.conversionEfficiency || 0}/20  |  Risco: ${baseIvs?.pillars?.riskLevel || 0}/15) Tj`,
    ``,
    `0 -30 Td /F1 14 Tf (FATORES DE RISCO) Tj`,
  ];

  const riskFactors = baseIvs?.riskFactors || [];
  if (riskFactors.length === 0) {
    contentLines.push(`/F1 10 Tf 0 -20 Td (Nenhum fator de risco identificado.) Tj`);
  } else {
    for (const f of riskFactors) {
      contentLines.push(`/F1 10 Tf 0 -16 Td (- ${f.replace(/[()\\]/g, '')}) Tj`);
    }
  }

  contentLines.push(`ET`);
  const stream = contentLines.join('\n');

  // Font
  const fontObj = addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
  // Page content
  const contentObj = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  // Page
  const pageObj = addObj(`<< /Type /Page /Parent 4 0 R /MediaBox [0 0 595 842] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`);
  // Pages
  const pagesObj = addObj(`<< /Type /Pages /Kids [${pageObj} 0 R] /Count 1 >>`);
  // Catalog
  const catalogObj = addObj(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);

  // Build PDF
  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj + '\n';
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objCount + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objCount + 1} /Root ${catalogObj} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const pdfBytes = generatePdf(body);

    return new Response(pdfBytes, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=relatorio-simulacao.pdf",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
