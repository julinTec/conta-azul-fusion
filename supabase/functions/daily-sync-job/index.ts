import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-cron-job",
};

const START_DATE = "2025-04-01";

type ContaAzulConfig = {
  id: string;
  school_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  schools: {
    slug: string;
    name: string;
  } | null;
};

async function fetchAllPages(endpoint: string, accessToken: string, params: Record<string, string>) {
  const allItems: any[] = [];
  let page = 1;
  const baseUrl = 'https://api-v2.contaazul.com';

  while (true) {
    const url = new URL(`${baseUrl}${endpoint}`);
    Object.entries({ ...params, pagina: page.toString(), tamanho_pagina: '100' }).forEach(([key, value]) => {
      url.searchParams.append(key, value);
    });

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Conta Azul v2 API fetch failed ${response.status}:`, errorText);
      if (response.status === 401) throw new Error('Token inválido ou expirado');
      throw new Error(`Erro ao buscar dados: ${response.status}`);
    }

    const data = await response.json();
    const items = data?.itens || [];
    if (items.length === 0) break;
    allItems.push(...items);
    page++;
    if (items.length > 0) await new Promise(resolve => setTimeout(resolve, 500));
  }
  return allItems;
}

async function chunkedUpsert(supabase: any, rows: any[], chunkSize = 500) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from("synced_transactions").upsert(chunk, { onConflict: "external_id" });
    if (error) throw error;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const incomingSecret = req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET_TOKEN");
    const authHeader = req.headers.get("authorization");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const bearerAnon = anonKey ? `Bearer ${anonKey}` : undefined;

    const authorized = (incomingSecret && expectedSecret && incomingSecret === expectedSecret) || 
                      (authHeader && bearerAnon && authHeader === bearerAnon);

    if (!authorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRole);

    const { data: rawConfigs, error: configError } = await supabase
      .from("conta_azul_config")
      .select("id, school_id, access_token, refresh_token, expires_at, schools(slug, name)")
      .not("school_id", "is", null);

    if (configError) {
      console.error("Error fetching configs:", configError);
      return new Response(JSON.stringify({ success: false, error: configError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Flatten the schools array to single object
    const configs: ContaAzulConfig[] = (rawConfigs || []).map((config: any) => ({
      ...config,
      schools: Array.isArray(config.schools) ? config.schools[0] : config.schools,
    }));

    if (!configs || configs.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "Nenhuma escola configurada", schoolsProcessed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`Found ${configs.length} school(s) with Conta Azul configuration`);
    const syncResults: any[] = [];

    for (const config of configs) {
      const schoolName = config.schools?.name || 'Unknown';
      const schoolSlug = config.schools?.slug || 'unknown';
      
      try {
        console.log(`\n========================================`);
        console.log(`Sincronizando: ${schoolName} (${schoolSlug})`);
        console.log(`========================================\n`);

        let accessToken = config.access_token;
        const now = Date.now();
        const expiresAt = new Date(config.expires_at).getTime();
        const buffer = 5 * 60 * 1000;

        if (!expiresAt || expiresAt <= now + buffer) {
          console.log(`[${schoolSlug}] Refreshing token...`);
          const refreshRes = await supabase.functions.invoke("conta-azul-auth", {
            body: { refreshToken: config.refresh_token },
          });

          if (refreshRes.error) {
            console.error(`[${schoolSlug}] Token refresh failed`);
            syncResults.push({ school: schoolName, slug: schoolSlug, success: false, error: "Token refresh failed" });
            continue;
          }

          const tokenData = refreshRes.data;
          accessToken = tokenData.access_token;

          await supabase.from("conta_azul_config").update({
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", config.id);
          
          console.log(`[${schoolSlug}] Token refreshed`);
        }

        const endDate = new Date().toISOString().split("T")[0];
        const params = { 'data_vencimento_de': START_DATE, 'data_vencimento_ate': endDate };

        const [receberItems, pagarItems] = await Promise.all([
          fetchAllPages('/v1/financeiro/eventos-financeiros/contas-a-receber/buscar', accessToken, params),
          fetchAllPages('/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar', accessToken, params),
        ]);

        const filteredReceberItems = receberItems.filter((item: any) => 
          ['RECEBIDO', 'ATRASADO', 'EM_ABERTO'].includes(item.status_traduzido));
        const filteredPagarItems = pagarItems.filter((item: any) => 
          ['RECEBIDO', 'ATRASADO', 'EM_ABERTO'].includes(item.status_traduzido));

        const incomeRows = filteredReceberItems.map((item: any) => ({
          external_id: `receber_${item.id}`, type: 'income',
          amount: item.status_traduzido === 'RECEBIDO' ? (item.pago ?? 0) : (item.total ?? 0),
          description: item.descricao || 'Conta a Receber', transaction_date: item.data_vencimento,
          status: item.status_traduzido, category_name: 'Receita', category_color: '#22c55e',
          entity_name: item.fornecedor?.nome || null, school_id: config.school_id, raw_data: item,
        }));

        const expenseRows = filteredPagarItems.map((item: any) => ({
          external_id: `pagar_${item.id}`, type: 'expense',
          amount: item.status_traduzido === 'RECEBIDO' ? (item.pago ?? 0) : (item.total ?? 0),
          description: item.descricao || 'Conta a Pagar', transaction_date: item.data_vencimento,
          status: item.status_traduzido, category_name: 'Despesa', category_color: '#ef4444',
          entity_name: item.fornecedor?.nome || null, school_id: config.school_id, raw_data: item,
        }));

        const allRows = [...incomeRows, ...expenseRows];

        await supabase.from("synced_transactions").delete().eq("school_id", config.school_id);
        if (allRows.length > 0) await chunkedUpsert(supabase, allRows, 500);

        console.log(`[${schoolSlug}] ✅ Synced ${allRows.length} transactions`);
        syncResults.push({
          school: schoolName, slug: schoolSlug, success: true,
          receivablesCount: incomeRows.length, payablesCount: expenseRows.length, totalTransactions: allRows.length,
        });
      } catch (schoolError: any) {
        console.error(`[${schoolSlug}] ❌ Failed:`, schoolError);
        syncResults.push({
          school: schoolName, slug: schoolSlug,
          success: false, error: schoolError.message,
        });
      }
    }

    const successfulSyncs = syncResults.filter(r => r.success);
    const failedSyncs = syncResults.filter(r => !r.success);
    const totalReceivables = successfulSyncs.reduce((sum, r) => sum + (r.receivablesCount || 0), 0);
    const totalPayables = successfulSyncs.reduce((sum, r) => sum + (r.payablesCount || 0), 0);
    const totalTransactions = successfulSyncs.reduce((sum, r) => sum + (r.totalTransactions || 0), 0);

    console.log(`\nRESUMO: ${successfulSyncs.length}/${configs.length} escolas sincronizadas, ${totalTransactions} transações\n`);

    try {
      await supabase.functions.invoke("send-sync-notification", {
        body: {
          status: failedSyncs.length > 0 ? "partial" : "success", receivablesCount: totalReceivables,
          payablesCount: totalPayables, totalTransactions, timestamp: new Date().toISOString(),
          syncResults, schoolsProcessed: configs.length, schoolsSuccessful: successfulSyncs.length,
          schoolsFailed: failedSyncs.length,
        },
      });
    } catch (emailError: any) {
      console.error("Failed to send email:", emailError.message);
    }

    return new Response(JSON.stringify({
      success: true, schoolsProcessed: configs.length, schoolsSuccessful: successfulSyncs.length,
      schoolsFailed: failedSyncs.length, totalReceivables, totalPayables, totalTransactions,
      results: syncResults, ranAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("Sync failed:", error);
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
