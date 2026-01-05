import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for Supabase background tasks
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-cron-job",
};

const START_DATE = "2025-04-01";
const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com';
const MAX_ROUNDS = 30; // Limite de segurança para evitar loops infinitos
const SELF_INVOKE_DELAY_MS = 30000; // 30 segundos entre rodadas
const BATCH_SAVE_SIZE = 50; // Salvar a cada 50 transações
const MAX_EXECUTION_TIME_MS = 140000; // 140 segundos (margem para timeout de 150s)

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

type SyncCheckpoint = {
  school_id: string;
  last_processed_index: number;
  total_transactions: number;
  success_count: number;
};

// Busca categoria real de uma transação via API de parcelas com retry robusto
async function fetchCategoryForTransaction(
  parcelaId: string, 
  accessToken: string,
  maxRetries = 5
): Promise<{ category: string | null; reason: string }> {
  let retryCount = 0;
  let delayMs = 300;
  
  while (retryCount <= maxRetries) {
    try {
      const url = `${CONTA_AZUL_API_BASE}/v1/financeiro/eventos-financeiros/parcelas/${parcelaId}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      
      if (response.status === 429) {
        // Rate limit - aguardar e tentar novamente (retry infinito para 429)
        console.log(`[Rate limit] Parcela ${parcelaId} - aguardando ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 5000); // Aumenta delay até 5s
        retryCount++; // Para 429, continua tentando
        if (retryCount > maxRetries) {
          // Para rate limit, damos mais chances
          retryCount = 0;
          await new Promise(resolve => setTimeout(resolve, 3000)); // 3s extra
        }
        continue;
      }
      
      if (response.status >= 500) {
        // Erro de servidor - retry com backoff
        console.log(`[Server error ${response.status}] Parcela ${parcelaId} - retry ${retryCount + 1}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs = Math.min(delayMs * 2, 5000);
        retryCount++;
        continue;
      }
      
      if (!response.ok) {
        return { category: null, reason: `http_error_${response.status}` };
      }
      
      const data = await response.json();
      const category = data?.evento?.rateio?.[0]?.nome_categoria || null;
      
      if (category) {
        return { category, reason: 'success' };
      }
      return { category: null, reason: 'no_rateio' };
      
    } catch (error) {
      console.error(`[Network error] Parcela ${parcelaId}:`, error);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 5000);
      retryCount++;
    }
  }
  
  return { category: null, reason: 'retry_exhausted' };
}

// Enriquece transações pendentes de categoria de forma sequencial e robusta
async function enrichPendingTransactions(
  supabase: any,
  schoolId: string,
  accessToken: string,
  startTime: number,
  logId: string
): Promise<{ enriched: number; total: number; completed: boolean }> {
  // Buscar transações com categorias fallback (pendentes de enriquecimento)
  const { data: pendingTx, error: pendingError } = await supabase
    .from('synced_transactions')
    .select('id, external_id, type, category_name')
    .eq('school_id', schoolId)
    .in('category_name', ['Outras Receitas', 'Outras Despesas'])
    .order('transaction_date', { ascending: true });
  
  if (pendingError) {
    console.error('Erro ao buscar transações pendentes:', pendingError);
    return { enriched: 0, total: 0, completed: false };
  }
  
  if (!pendingTx || pendingTx.length === 0) {
    console.log('✅ Todas as transações já possuem categorias reais!');
    return { enriched: 0, total: 0, completed: true };
  }
  
  console.log(`📋 ${pendingTx.length} transações pendentes de enriquecimento`);
  
  let enrichedCount = 0;
  let batchUpdates: any[] = [];
  let dynamicDelay = 300; // Começa com 300ms entre requests
  
  for (let i = 0; i < pendingTx.length; i++) {
    // Verificar timeout
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > MAX_EXECUTION_TIME_MS) {
      console.log(`⏱️ Timeout alcançado após ${i} transações. Salvando progresso...`);
      
      // Salvar batch pendente
      if (batchUpdates.length > 0) {
        for (const update of batchUpdates) {
          await supabase
            .from('synced_transactions')
            .update({ category_name: update.category_name })
            .eq('id', update.id);
        }
      }
      
      // Atualizar log
      await supabase
        .from('sync_logs')
        .update({
          transactions_enriched: enrichedCount,
          categories_found: enrichedCount,
          status: 'timeout',
          metadata: { 
            processed_this_round: i, 
            pending_remaining: pendingTx.length - i,
            will_continue: true
          }
        })
        .eq('id', logId);
      
      return { enriched: enrichedCount, total: pendingTx.length, completed: false };
    }
    
    const tx = pendingTx[i];
    const parcelaId = tx.external_id.replace(/^(receber_|pagar_)/, '');
    
    const { category, reason } = await fetchCategoryForTransaction(parcelaId, accessToken);
    
    if (category) {
      batchUpdates.push({ id: tx.id, category_name: category });
      enrichedCount++;
      // Sucesso - diminuir delay gradualmente
      dynamicDelay = Math.max(150, dynamicDelay - 20);
    } else if (reason === 'rate_limit') {
      // Rate limit persistente - aumentar delay
      dynamicDelay = Math.min(3000, dynamicDelay * 2);
    }
    
    // Salvar batch incrementalmente
    if (batchUpdates.length >= BATCH_SAVE_SIZE) {
      console.log(`💾 Salvando batch de ${batchUpdates.length} categorias (${i + 1}/${pendingTx.length})...`);
      for (const update of batchUpdates) {
        await supabase
          .from('synced_transactions')
          .update({ category_name: update.category_name })
          .eq('id', update.id);
      }
      batchUpdates = [];
      
      // Atualizar log de progresso
      await supabase
        .from('sync_logs')
        .update({
          transactions_enriched: enrichedCount,
          categories_found: enrichedCount,
          metadata: { progress: `${i + 1}/${pendingTx.length}` }
        })
        .eq('id', logId);
    }
    
    // Log de progresso a cada 100
    if ((i + 1) % 100 === 0) {
      console.log(`📊 Progresso: ${i + 1}/${pendingTx.length} (${enrichedCount} categorias encontradas)`);
    }
    
    // Delay adaptativo entre requests
    await new Promise(resolve => setTimeout(resolve, dynamicDelay));
  }
  
  // Salvar últimas atualizações pendentes
  if (batchUpdates.length > 0) {
    console.log(`💾 Salvando batch final de ${batchUpdates.length} categorias...`);
    for (const update of batchUpdates) {
      await supabase
        .from('synced_transactions')
        .update({ category_name: update.category_name })
        .eq('id', update.id);
    }
  }
  
  console.log(`✅ Enriquecimento completo: ${enrichedCount}/${pendingTx.length} categorias encontradas`);
  return { enriched: enrichedCount, total: pendingTx.length, completed: true };
}

async function fetchAllPages(endpoint: string, accessToken: string, params: Record<string, string>) {
  const allItems: any[] = [];
  let page = 1;

  while (true) {
    const url = new URL(`${CONTA_AZUL_API_BASE}${endpoint}`);
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

// Self-invocation: chama a si mesmo para continuar o processamento
async function selfInvoke(supabaseUrl: string, anonKey: string, roundNumber: number) {
  console.log(`🔄 Auto-restart: aguardando ${SELF_INVOKE_DELAY_MS / 1000}s antes da rodada ${roundNumber + 1}...`);
  
  await new Promise(resolve => setTimeout(resolve, SELF_INVOKE_DELAY_MS));
  
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/daily-sync-job`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        is_continuation: true, 
        round_number: roundNumber + 1 
      }),
    });
    
    if (!response.ok) {
      console.error(`❌ Falha ao auto-reiniciar: ${response.status}`);
    } else {
      console.log(`✅ Próxima rodada iniciada com sucesso`);
    }
  } catch (error) {
    console.error('❌ Erro ao auto-reiniciar:', error);
  }
}

serve(async (req) => {
  const startTime = Date.now();
  
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Parse body para verificar se é continuation
    let isContinuation = false;
    let roundNumber = 1;
    
    try {
      const body = await req.json();
      isContinuation = body?.is_continuation || false;
      roundNumber = body?.round_number || 1;
    } catch {
      // Body vazio ou inválido - é a primeira rodada
    }
    
    // Verificar limite de rodadas
    if (roundNumber > MAX_ROUNDS) {
      console.error(`⚠️ Limite de ${MAX_ROUNDS} rodadas atingido. Parando sync.`);
      return new Response(JSON.stringify({ 
        error: "Max rounds exceeded", 
        round: roundNumber 
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 DAILY SYNC JOB - Rodada ${roundNumber}/${MAX_ROUNDS}`);
    console.log(`${'='.repeat(60)}\n`);

    const incomingSecret = req.headers.get("x-cron-secret");
    const expectedSecret = Deno.env.get("CRON_SECRET_TOKEN");
    const authHeader = req.headers.get("authorization");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const bearerAnon = anonKey ? `Bearer ${anonKey}` : undefined;

    const authorized = (incomingSecret && expectedSecret && incomingSecret === expectedSecret) || 
                      (authHeader && bearerAnon && authHeader === bearerAnon) ||
                      isContinuation; // Continuations são autorizadas

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
      .select(`
        id, school_id, access_token, refresh_token, expires_at,
        schools(slug, name)
      `)
      .not("school_id", "is", null);

    if (configError) {
      console.error("Error fetching configs:", configError);
      return new Response(JSON.stringify({ success: false, error: configError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const configs: ContaAzulConfig[] = (rawConfigs || []).map((config: any) => ({
      ...config,
      schools: Array.isArray(config.schools) ? config.schools[0] : config.schools,
    }));

    if (!configs || configs.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "Nenhuma escola configurada", schoolsProcessed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`📚 ${configs.length} escola(s) com Conta Azul configurado`);
    
    const syncResults: any[] = [];
    let anyPendingEnrichment = false;

    for (const config of configs) {
      const schoolName = config.schools?.name || 'Unknown';
      const schoolSlug = config.schools?.slug || 'unknown';
      
      try {
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📍 ${schoolName} (${schoolSlug})`);
        console.log(`${'─'.repeat(50)}`);

        // Criar log para esta escola e rodada
        const { data: logEntry, error: logError } = await supabase
          .from('sync_logs')
          .insert({
            school_id: config.school_id,
            round_number: roundNumber,
            status: 'running',
            started_at: new Date().toISOString()
          })
          .select('id')
          .single();
        
        const logId = logEntry?.id;

        // Buscar credenciais OAuth
        const { data: oauthCreds, error: credsError } = await supabase
          .from('school_oauth_credentials')
          .select('client_id, client_secret')
          .eq('school_id', config.school_id)
          .single();

        if (credsError || !oauthCreds) {
          console.error(`❌ Credenciais OAuth não encontradas`);
          await supabase.from('sync_logs').update({ 
            status: 'failed', 
            error_message: 'OAuth credentials not found',
            completed_at: new Date().toISOString()
          }).eq('id', logId);
          syncResults.push({ school: schoolName, slug: schoolSlug, success: false, error: "OAuth credentials not found" });
          continue;
        }

        let accessToken = config.access_token;
        const now = Date.now();
        const expiresAt = new Date(config.expires_at).getTime();
        const buffer = 5 * 60 * 1000;

        // Refresh token se necessário
        if (!expiresAt || expiresAt <= now + buffer) {
          console.log(`🔑 Renovando token...`);
          const refreshRes = await supabase.functions.invoke("conta-azul-auth", {
            body: { 
              refreshToken: config.refresh_token,
              client_id: oauthCreds.client_id,
              client_secret: oauthCreds.client_secret
            },
          });

          if (refreshRes.error || !refreshRes.data?.access_token) {
            console.error(`❌ Falha ao renovar token`);
            await supabase.from('sync_logs').update({ 
              status: 'failed', 
              error_message: 'Token refresh failed - reconexão necessária',
              completed_at: new Date().toISOString()
            }).eq('id', logId);
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
          
          console.log(`✅ Token renovado`);
        }

        // Na primeira rodada, buscar dados do Conta Azul
        if (roundNumber === 1) {
          console.log(`📥 Buscando dados do Conta Azul...`);
          
          const endDate = new Date().toISOString().split("T")[0];
          const params = { 'data_vencimento_de': START_DATE, 'data_vencimento_ate': endDate };

          const [receberItems, pagarItems] = await Promise.all([
            fetchAllPages('/v1/financeiro/eventos-financeiros/contas-a-receber/buscar', accessToken, params),
            fetchAllPages('/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar', accessToken, params),
          ]);

          console.log(`📊 Recebido: ${receberItems.length} receitas, ${pagarItems.length} despesas`);

          const filteredReceberItems = receberItems.filter((item: any) => 
            ['RECEBIDO', 'ATRASADO', 'EM_ABERTO'].includes(item.status_traduzido));
          const filteredPagarItems = pagarItems.filter((item: any) => 
            ['RECEBIDO', 'ATRASADO', 'EM_ABERTO'].includes(item.status_traduzido));

          // Mapear com fallback
          const incomeRows = filteredReceberItems.map((item: any) => ({
            external_id: `receber_${item.id}`, type: 'income',
            amount: item.status_traduzido === 'RECEBIDO' ? (item.pago ?? 0) : (item.total ?? 0),
            description: item.descricao || 'Conta a Receber', transaction_date: item.data_vencimento,
            status: item.status_traduzido, 
            category_name: 'Outras Receitas',
            category_color: '#22c55e',
            entity_name: item.fornecedor?.nome || null, school_id: config.school_id, raw_data: item,
          }));

          const expenseRows = filteredPagarItems.map((item: any) => ({
            external_id: `pagar_${item.id}`, type: 'expense',
            amount: item.status_traduzido === 'RECEBIDO' ? (item.pago ?? 0) : (item.total ?? 0),
            description: item.descricao || 'Conta a Pagar', transaction_date: item.data_vencimento,
            status: item.status_traduzido, 
            category_name: 'Outras Despesas',
            category_color: '#ef4444',
            entity_name: item.fornecedor?.nome || null, school_id: config.school_id, raw_data: item,
          }));

          const allRows = [...incomeRows, ...expenseRows];
          
          console.log(`💾 Salvando ${allRows.length} transações com categorias fallback...`);
          
          // Deletar transações antigas e inserir novas
          await supabase.from("synced_transactions").delete().eq("school_id", config.school_id);
          if (allRows.length > 0) await chunkedUpsert(supabase, allRows, 500);
          
          await supabase.from('sync_logs').update({ 
            transactions_fetched: allRows.length 
          }).eq('id', logId);
          
          console.log(`✅ ${allRows.length} transações salvas`);
        }

        // Enriquecer categorias pendentes
        console.log(`🏷️ Iniciando enriquecimento de categorias...`);
        
        const enrichResult = await enrichPendingTransactions(
          supabase, 
          config.school_id, 
          accessToken, 
          startTime,
          logId
        );

        if (!enrichResult.completed) {
          anyPendingEnrichment = true;
        }

        // Atualizar log final
        await supabase.from('sync_logs').update({ 
          status: enrichResult.completed ? 'completed' : 'timeout',
          completed_at: new Date().toISOString(),
          transactions_enriched: enrichResult.enriched,
          categories_found: enrichResult.enriched
        }).eq('id', logId);

        syncResults.push({
          school: schoolName, 
          slug: schoolSlug, 
          success: true,
          enriched: enrichResult.enriched,
          pending: enrichResult.total - enrichResult.enriched,
          completed: enrichResult.completed
        });

      } catch (schoolError: any) {
        console.error(`❌ Erro:`, schoolError);
        syncResults.push({
          school: schoolName, slug: schoolSlug,
          success: false, error: schoolError.message,
        });
      }
    }

    // Buscar estatísticas finais do banco para o email (sempre)
    const { data: finalStats } = await supabase
      .from('synced_transactions')
      .select('type, amount')
      .in('school_id', configs.map(c => c.school_id));
    
    const receivablesCount = finalStats?.filter((t: any) => t.type === 'income').length || 0;
    const payablesCount = finalStats?.filter((t: any) => t.type === 'expense').length || 0;
    const totalTransactions = (finalStats?.length || 0);
    
    // Formatar resultados por escola com contagens
    const formattedResults = await Promise.all(syncResults.map(async (r) => {
      if (r.success) {
        const schoolConfig = configs.find(c => c.schools?.slug === r.slug);
        if (schoolConfig) {
          const { data: schoolStats } = await supabase
            .from('synced_transactions')
            .select('type')
            .eq('school_id', schoolConfig.school_id);
          
          return {
            school: r.school,
            slug: r.slug,
            success: true,
            receivablesCount: schoolStats?.filter((t: any) => t.type === 'income').length || 0,
            payablesCount: schoolStats?.filter((t: any) => t.type === 'expense').length || 0,
            totalTransactions: schoolStats?.length || 0
          };
        }
      }
      return r;
    }));

    // Verificar se precisa continuar
    if (anyPendingEnrichment && roundNumber < MAX_ROUNDS) {
      console.log(`\n⏳ Ainda há transações pendentes. Agendando próxima rodada...`);
      
      // Self-invoke em background usando waitUntil para garantir execução
      EdgeRuntime.waitUntil(
        selfInvoke(supabaseUrl, anonKey!, roundNumber).catch(err => 
          console.error('Erro no auto-restart:', err)
        )
      );
    } else {
      // Sincronização completa OU primeira rodada sem novas transações - enviar email
      const isNoChanges = roundNumber === 1 && syncResults.every(r => r.success && r.enriched === 0 && r.pending === 0);
      const statusType = isNoChanges ? "no_changes" : "success";
      const statusMessage = isNoChanges 
        ? "Verificação diária concluída - todos os dados estão atualizados" 
        : "Sincronização completa com sucesso";
      
      console.log(`\n🎉 ${statusMessage}`);
      
      // Enviar notificação
      try {
        const successfulSyncs = syncResults.filter(r => r.success);
        
        console.log(`📧 Enviando email de notificação (${statusType})...`);
        
        const notificationResponse = await supabase.functions.invoke("send-sync-notification", {
          body: {
            status: statusType,
            receivablesCount,
            payablesCount,
            totalTransactions,
            timestamp: new Date().toISOString(),
            syncResults: formattedResults,
            schoolsProcessed: configs.length,
            schoolsSuccessful: successfulSyncs.length,
            schoolsFailed: syncResults.filter(r => !r.success).length,
            message: statusMessage
          },
        });
        
        if (notificationResponse.error) {
          console.error("❌ Falha ao enviar email:", notificationResponse.error);
        } else {
          console.log(`✅ Email de notificação enviado com sucesso!`);
        }
      } catch (emailError: any) {
        console.error("❌ Falha ao enviar email:", emailError.message);
      }
    }

    const successfulSyncs = syncResults.filter(r => r.success);
    
    return new Response(JSON.stringify({
      success: true,
      round: roundNumber,
      maxRounds: MAX_ROUNDS,
      schoolsProcessed: configs.length,
      schoolsSuccessful: successfulSyncs.length,
      allCompleted: !anyPendingEnrichment,
      willContinue: anyPendingEnrichment && roundNumber < MAX_ROUNDS,
      results: syncResults,
      ranAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    console.error("❌ Sync failed:", error);
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
