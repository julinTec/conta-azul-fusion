import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-cron-job",
};

// Data range start for full sync
const START_DATE = "2025-04-01";

type ContaAzulConfig = {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO
};

// Função removida - não precisamos mais do Vault

// Helper function to fetch all pages from Conta Azul API v2
async function fetchAllPages(
  endpoint: string,
  accessToken: string,
  params: Record<string, string>
) {
  const allItems: any[] = [];
  let page = 1;
  const baseUrl = 'https://api-v2.contaazul.com';

  while (true) {
    const url = new URL(`${baseUrl}${endpoint}`);
    Object.entries({ ...params, pagina: page.toString(), tamanho_pagina: '100' }).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Conta Azul v2 API fetch failed ${response.status}:`, errorText);
      if (response.status === 401) {
        throw new Error('Token de acesso inválido ou expirado. A sincronização falhará até reconectar ao Conta Azul.');
      }
      throw new Error(`Erro ao buscar dados do Conta Azul: ${response.status}`);
    }

    const data = await response.json();
    const items = data?.itens || [];
    if (items.length === 0) break;

    allItems.push(...items);
    page++;
    
    // Delay para respeitar rate limiting da API
    if (items.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return allItems;
}

async function chunkedUpsert(supabase: any, rows: any[], chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from("synced_transactions")
      .upsert(chunk, { onConflict: "external_id" });
    if (error) throw error;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authorization: accept either a private X-Cron-Secret or a valid anon token for cron
    const incomingSecret = req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET_TOKEN");

    const authHeader = req.headers.get("authorization");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const bearerAnon = anonKey ? `Bearer ${anonKey}` : undefined;

    const authorized =
      (incomingSecret && expectedSecret && incomingSecret === expectedSecret) ||
      (authHeader && bearerAnon && authHeader === bearerAnon);

    if (!authorized) {
      console.error("Unauthorized cron call");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    // 1) Load Conta Azul config
    const { data: config, error: configError } = await supabase
      .from("conta_azul_config")
      .select("id, access_token, refresh_token, expires_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<ContaAzulConfig>();

    if (configError) throw configError;
    if (!config) {
      return new Response(JSON.stringify({ error: "Conta Azul não está conectada" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!config.access_token || !config.refresh_token) {
      return new Response(JSON.stringify({ error: "Tokens não encontrados. Por favor, reconecte ao Conta Azul." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log('Loading tokens from database...');

    // Tokens agora vêm diretamente da tabela
    let accessToken = config.access_token;
    let refreshToken = config.refresh_token;

    const now = Date.now();
    const expiresAt = new Date(config.expires_at).getTime();
    const buffer = 5 * 60 * 1000;

    // 2) Refresh token if expired/near expiry
    if (!expiresAt || expiresAt <= now + buffer) {
      console.log("Refreshing Conta Azul access token...");
      const refreshRes = await supabase.functions.invoke("conta-azul-auth", {
        body: { refreshToken: refreshToken },
      });
      if (refreshRes.error) throw refreshRes.error;

      const tokenData: any = refreshRes.data;
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token;

      console.log('Updating tokens in database...');

      // Atualizar tokens diretamente na config
      const update = await supabase
        .from("conta_azul_config")
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", config.id);
      if (update.error) throw update.error;
      console.log("Token refreshed and saved to database.");
    }

    // 3) Fetch data from Conta Azul using v2 API
    const endDate = new Date().toISOString().split("T")[0];
    console.log(`Fetching receivables/payables from ${START_DATE} to ${endDate}...`);

    // Buscar escola padrão (Paulo Freire)
    const { data: defaultSchool } = await supabase
      .from('schools')
      .select('id')
      .eq('slug', 'paulo-freire')
      .maybeSingle();
    const schoolId = defaultSchool?.id;

    const params = {
      'data_vencimento_de': START_DATE,
      'data_vencimento_ate': endDate,
    };

    // Buscar contas a receber e a pagar usando v2 API
    const [receberItems, pagarItems] = await Promise.all([
      fetchAllPages('/v1/financeiro/eventos-financeiros/contas-a-receber/buscar', accessToken, params),
      fetchAllPages('/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar', accessToken, params),
    ]);

    // Filtrar itens com status relevantes
    const filteredReceberItems = receberItems.filter((item: any) => 
      item.status_traduzido === 'RECEBIDO' || item.status_traduzido === 'ATRASADO' || item.status_traduzido === 'EM_ABERTO'
    );
    const filteredPagarItems = pagarItems.filter((item: any) => 
      item.status_traduzido === 'RECEBIDO' || item.status_traduzido === 'ATRASADO' || item.status_traduzido === 'EM_ABERTO'
    );

    // Mapear para o formato da tabela (alinhado com sync-conta-azul)
    const incomeRows = filteredReceberItems.map((item: any) => ({
      external_id: `receber_${item.id}`,
      type: 'income',
          amount: item.status_traduzido === 'RECEBIDO' ? (item.pago ?? 0) : (item.total ?? 0),
      description: item.descricao || 'Conta a Receber',
      transaction_date: item.data_vencimento,
      status: item.status_traduzido,
      category_name: 'Receita',
      category_color: '#22c55e',
      entity_name: item.fornecedor?.nome || null,
      school_id: schoolId,
      raw_data: item,
    }));

    const expenseRows = filteredPagarItems.map((item: any) => ({
      external_id: `pagar_${item.id}`,
      type: 'expense',
      amount: item.status_traduzido === 'RECEBIDO' ? (item.pago ?? 0) : (item.total ?? 0),
      description: item.descricao || 'Conta a Pagar',
      transaction_date: item.data_vencimento,
      status: item.status_traduzido,
      category_name: 'Despesa',
      category_color: '#ef4444',
      entity_name: item.fornecedor?.nome || null,
      school_id: schoolId,
      raw_data: item,
    }));

    const allRows = [...incomeRows, ...expenseRows];

    console.log(`Fetched ${receberItems.length} contas a receber, ${pagarItems.length} contas a pagar. Filtered to ${allRows.length} RECEBIDO transactions`);

    // 4) Clear and upsert
    const { error: delError } = await supabase
      .from("synced_transactions")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delError) throw delError;

    if (allRows.length > 0) {
      await chunkedUpsert(supabase, allRows, 500);
    }

    // 5) Send email notification
    try {
      await supabase.functions.invoke("send-sync-notification", {
        body: {
          status: "success",
          receivablesCount: incomeRows.length,
          payablesCount: expenseRows.length,
          totalTransactions: allRows.length,
          timestamp: new Date().toISOString(),
        },
      });
      console.log("Email notification sent successfully");
    } catch (emailError: any) {
      console.error("Failed to send email notification:", emailError.message);
      // Don't fail the sync if email fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        received: receberItems.length,
        payables: pagarItems.length,
        insertedOrUpdated: allRows.length,
        ranAt: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("daily-sync-job error:", e);
    
    // Send error notification email
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, serviceRole);
      
      await supabase.functions.invoke("send-sync-notification", {
        body: {
          status: "error",
          receivablesCount: 0,
          payablesCount: 0,
          totalTransactions: 0,
          timestamp: new Date().toISOString(),
          errorMessage: e?.message ?? String(e),
        },
      });
      console.log("Error notification email sent");
    } catch (emailError: any) {
      console.error("Failed to send error notification email:", emailError.message);
    }

    return new Response(JSON.stringify({ success: false, error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});