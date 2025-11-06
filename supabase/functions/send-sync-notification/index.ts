import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SyncNotificationRequest {
  status: "success" | "error";
  receivablesCount: number;
  payablesCount: number;
  totalTransactions: number;
  timestamp: string;
  errorMessage?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      status,
      receivablesCount,
      payablesCount,
      totalTransactions,
      timestamp,
      errorMessage,
    }: SyncNotificationRequest = await req.json();

    console.log("Sending sync notification email:", {
      status,
      receivablesCount,
      payablesCount,
      totalTransactions,
    });

    const isSuccess = status === "success";
    const statusColor = isSuccess ? "#10b981" : "#ef4444";
    const statusIcon = isSuccess ? "✅" : "❌";
    const statusText = isSuccess ? "Sucesso" : "Erro";

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .header {
              background: ${statusColor};
              color: white;
              padding: 20px;
              border-radius: 8px 8px 0 0;
              text-align: center;
            }
            .header h1 {
              margin: 0;
              font-size: 24px;
            }
            .content {
              background: #f9fafb;
              padding: 30px;
              border-radius: 0 0 8px 8px;
              border: 1px solid #e5e7eb;
              border-top: none;
            }
            .stat-row {
              display: flex;
              justify-content: space-between;
              padding: 12px 0;
              border-bottom: 1px solid #e5e7eb;
            }
            .stat-row:last-child {
              border-bottom: none;
            }
            .stat-label {
              font-weight: 600;
              color: #6b7280;
            }
            .stat-value {
              font-weight: 700;
              color: #111827;
            }
            .error-box {
              background: #fee2e2;
              border: 1px solid #ef4444;
              border-radius: 6px;
              padding: 15px;
              margin-top: 20px;
            }
            .error-box h3 {
              margin: 0 0 10px 0;
              color: #dc2626;
            }
            .error-box p {
              margin: 0;
              color: #7f1d1d;
              font-family: monospace;
              font-size: 12px;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              color: #6b7280;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${statusIcon} Sincronização Conta Azul - ${statusText}</h1>
          </div>
          <div class="content">
            <div class="stat-row">
              <span class="stat-label">🕐 Data/Hora</span>
              <span class="stat-value">${new Date(timestamp).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">📊 Status</span>
              <span class="stat-value" style="color: ${statusColor}">${statusText}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">💰 Receitas</span>
              <span class="stat-value">${receivablesCount} itens</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">💸 Despesas</span>
              <span class="stat-value">${payablesCount} itens</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">📈 Total Sincronizado</span>
              <span class="stat-value">${totalTransactions} transações</span>
            </div>
            ${errorMessage ? `
              <div class="error-box">
                <h3>❌ Detalhes do Erro</h3>
                <p>${errorMessage}</p>
              </div>
            ` : ''}
          </div>
          <div class="footer">
            <p>Sincronização automática Conta Azul</p>
            <p>Este é um email automático, não responda.</p>
          </div>
        </body>
      </html>
    `;

    const emailResponse = await resend.emails.send({
      from: "Conta Azul Sync <onboarding@resend.dev>",
      to: ["julio.cezar@redebloom.com.br"],
      subject: `${statusIcon} Sincronização Conta Azul - ${statusText}`,
      html,
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error sending sync notification email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
