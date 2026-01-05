import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

interface SyncResult {
  school: string; slug: string; success: boolean;
  receivablesCount?: number; payablesCount?: number; totalTransactions?: number; error?: string;
}

interface SyncNotificationRequest {
  status: "success" | "error" | "partial" | "no_changes"; receivablesCount: number; payablesCount: number;
  totalTransactions: number; timestamp: string; errorMessage?: string; syncResults?: SyncResult[];
  schoolsProcessed?: number; schoolsSuccessful?: number; schoolsFailed?: number; message?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { status, receivablesCount, payablesCount, totalTransactions, timestamp, errorMessage,
      syncResults, schoolsProcessed, schoolsSuccessful, schoolsFailed, message }: SyncNotificationRequest = await req.json();

    const isSuccess = status === "success";
    const isNoChanges = status === "no_changes";
    const isPartial = status === "partial";
    const statusColor = isSuccess || isNoChanges ? "#10b981" : isPartial ? "#f59e0b" : "#ef4444";
    const statusIcon = isSuccess ? "✅" : isNoChanges ? "📋" : isPartial ? "⚠️" : "❌";
    const statusText = isSuccess ? "Sucesso" : isNoChanges ? "Verificado" : isPartial ? "Parcial" : "Erro";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px}
      .header{background:${statusColor};color:white;padding:20px;border-radius:8px 8px 0 0;text-align:center}.header h1{margin:0;font-size:24px}
      .content{background:#f9fafb;padding:30px;border-radius:0 0 8px 8px;border:1px solid #e5e7eb;border-top:none}
      .stat-row{display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e5e7eb}.stat-row:last-child{border-bottom:none}
      .stat-label{font-weight:600;color:#6b7280}.stat-value{font-weight:700;color:#111827}
      .school-card{background:white;padding:15px;border-radius:6px;margin-bottom:10px}
      .school-card-success{border-left:4px solid #10b981}.school-card-error{border-left:4px solid #ef4444}
      .school-name{font-weight:600;margin-bottom:8px;color:#111827}.school-stats{font-size:14px;color:#6b7280}.school-error{color:#dc2626;font-size:14px}
      .footer{text-align:center;margin-top:30px;color:#6b7280;font-size:14px}
    </style></head><body>
      <div class="header"><h1>${statusIcon} Sincronização Conta Azul - ${statusText}</h1></div>
      <div class="content">
        <div class="stat-row"><span class="stat-label">🕐 Data/Hora</span><span class="stat-value">${new Date(timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span></div>
        ${schoolsProcessed !== undefined ? `
        <div class="stat-row"><span class="stat-label">🏫 Escolas Processadas</span><span class="stat-value">${schoolsProcessed}</span></div>
        <div class="stat-row"><span class="stat-label">✅ Sincronizadas</span><span class="stat-value">${schoolsSuccessful}</span></div>
        ${schoolsFailed && schoolsFailed > 0 ? `<div class="stat-row"><span class="stat-label">❌ Falhadas</span><span class="stat-value">${schoolsFailed}</span></div>` : ''}` : ''}
        <div class="stat-row"><span class="stat-label">📥 Contas a Receber</span><span class="stat-value">${receivablesCount}</span></div>
        <div class="stat-row"><span class="stat-label">📤 Contas a Pagar</span><span class="stat-value">${payablesCount}</span></div>
        <div class="stat-row"><span class="stat-label">💼 Total de Transações</span><span class="stat-value">${totalTransactions}</span></div>
        ${syncResults && syncResults.length > 0 ? `<div style="margin-top:30px"><h3 style="color:#111827;margin-bottom:15px">📊 Detalhes por Escola</h3>
        ${syncResults.map(r => `<div class="school-card ${r.success ? 'school-card-success' : 'school-card-error'}">
          <div class="school-name">${r.success ? '✅' : '❌'} ${r.school}</div>
          ${r.success ? `<div class="school-stats"><div>Receitas: ${r.receivablesCount || 0}</div><div>Despesas: ${r.payablesCount || 0}</div><div>Total: ${r.totalTransactions || 0} transações</div></div>` 
          : `<div class="school-error">Erro: ${r.error || 'Falha desconhecida'}</div>`}</div>`).join('')}</div>` : ''}
      </div>
      <div class="footer"><p>Sincronização automática Conta Azul</p><p>Este é um email automático, não responda.</p></div>
    </body></html>`;

    const emailResponse = await resend.emails.send({
      from: "Conta Azul Sync <onboarding@resend.dev>",
      to: ["julio.cezar@redebloom.com.br"],
      subject: `${statusIcon} Sincronização Conta Azul - ${statusText}`,
      html,
    });

    return new Response(JSON.stringify(emailResponse), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (error: any) {
    console.error("Error in send-sync-notification:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
};

serve(handler);
