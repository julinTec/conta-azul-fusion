import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

// Declarar EdgeRuntime para background tasks
declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com';

// Busca categoria com retry para rate limits
async function fetchCategoryForTransaction(
  parcelaId: string, 
  accessToken: string
): Promise<{ category: string | null; reason: string }> {
  const url = `${CONTA_AZUL_API_BASE}/v1/financeiro/eventos-financeiros/parcelas/${parcelaId}`;
  
  let attempt = 0;
  const maxRetries = 5;
  
  while (attempt < maxRetries) {
    attempt++;
    
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      
      // Rate limit - esperar e tentar novamente
      if (response.status === 429) {
        const backoffMs = 2000 * attempt;
        console.log(`[FETCH] Rate limit for ${parcelaId}, waiting ${backoffMs}ms (attempt ${attempt})...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
      
      // Erro de servidor - retry
      if (response.status >= 500) {
        if (attempt < maxRetries) {
          const backoffMs = 1000 * attempt;
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        }
        return { category: null, reason: 'http_error' };
      }
      
      if (!response.ok) {
        return { category: null, reason: 'http_error' };
      }
      
      const data = await response.json();
      const rateio = data?.evento?.rateio;
      
      if (!rateio || rateio.length === 0) {
        return { category: null, reason: 'no_rateio' };
      }
      
      const categoria = rateio[0]?.nome_categoria;
      if (!categoria) {
        return { category: null, reason: 'empty_categoria' };
      }
      
      return { category: categoria, reason: 'success' };
      
    } catch (error) {
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        continue;
      }
      return { category: null, reason: 'network_error' };
    }
  }
  
  return { category: null, reason: 'max_retries' };
}

// Enriquece transações PENDENTES (com categoria fallback)
async function enrichPendingTransactions(
  pendingTx: any[], 
  accessToken: string,
  supabaseClient: any,
  schoolId: string,
  totalInDb: number,
  alreadyEnriched: number,
  startIndex: number = 0
): Promise<{ processed: number; successCount: number; completed: boolean; totalProcessed: number }> {
  const saveEvery = 50;
  const delayMs = 200;
  
  let successCount = 0;
  let processed = startIndex;
  const startTime = Date.now();
  
  console.log(`[ENRICH] Starting from index ${startIndex} of ${pendingTx.length} pending (${totalInDb} total in DB)`);
  
  for (let i = startIndex; i < pendingTx.length; i++) {
    const tx = pendingTx[i];
    const parcelaId = tx.external_id.replace(/^(receber_|pagar_)/, '');
    
    // Buscar categoria
    const result = await fetchCategoryForTransaction(parcelaId, accessToken);
    
    if (result.reason === 'success' && result.category) {
      tx.category_name = result.category;
      successCount++;
      
      // Atualizar imediatamente no banco
      await supabaseClient
        .from('synced_transactions')
        .update({ category_name: result.category })
        .eq('external_id', tx.external_id);
    }
    
    processed = i + 1;
    
    // Atualizar checkpoint periodicamente
    if (processed % saveEvery === 0) {
      const totalProcessedSoFar = alreadyEnriched + processed;
      
      await supabaseClient
        .from('sync_checkpoints')
        .upsert({
          school_id: schoolId,
          last_processed_index: processed,
          total_transactions: pendingTx.length,
          success_count: successCount,
          updated_at: new Date().toISOString()
        }, { onConflict: 'school_id' });
      
      console.log(`[ENRICH] Saved ${processed}/${pendingTx.length} pending (${totalProcessedSoFar}/${totalInDb} total)`);
    }
    
    // Log de progresso
    if (processed % 100 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (processed - startIndex) / elapsed;
      const remaining = pendingTx.length - processed;
      const estimatedMin = Math.ceil(remaining / rate / 60);
      console.log(`[ENRICH] Progress: ${processed}/${pendingTx.length} pending | ~${estimatedMin}min remaining`);
    }
    
    // Delay entre requests
    if (i < pendingTx.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  const totalProcessed = alreadyEnriched + processed;
  const completed = processed >= pendingTx.length;
  
  if (completed) {
    // Verificar se ainda há pendentes (pode ter havido novos dados)
    const { count: stillPending } = await supabaseClient
      .from('synced_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .in('category_name', ['Outras Receitas', 'Outras Despesas']);
    
    if (stillPending && stillPending > 0) {
      console.log(`[ENRICH] Found ${stillPending} more pending transactions`);
      // Não deletar checkpoint se ainda há pendentes
      await supabaseClient
        .from('sync_checkpoints')
        .upsert({
          school_id: schoolId,
          last_processed_index: 0,
          total_transactions: stillPending,
          success_count: 0,
          updated_at: new Date().toISOString()
        }, { onConflict: 'school_id' });
      
      return { processed, successCount, completed: false, totalProcessed };
    }
    
    // Realmente completou - deletar checkpoint
    await supabaseClient
      .from('sync_checkpoints')
      .delete()
      .eq('school_id', schoolId);
    
    console.log(`[ENRICH] === FULLY COMPLETED === ${successCount} categories added this batch, ${totalProcessed} total in DB`);
  } else {
    // Atualizar checkpoint final
    await supabaseClient
      .from('sync_checkpoints')
      .upsert({
        school_id: schoolId,
        last_processed_index: processed,
        total_transactions: pendingTx.length,
        success_count: successCount,
        updated_at: new Date().toISOString()
      }, { onConflict: 'school_id' });
  }
  
  return { processed, successCount, completed, totalProcessed };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verificar se o usuário é admin
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Não autenticado');
    }

    const { data: roles } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!roles) {
      throw new Error('Acesso negado. Apenas administradores podem sincronizar.');
    }

    // Receber school_id do body
    const body = await req.json();
    const { school_id, resume_only } = body;

    // Buscar escola padrão se não fornecido
    let targetSchoolId = school_id;
    if (!targetSchoolId) {
      const { data: defaultSchool } = await supabaseClient
        .from('schools')
        .select('id')
        .eq('slug', 'paulo-freire')
        .single();
      targetSchoolId = defaultSchool?.id;
    }

    console.log('[SYNC] Starting sync for school_id:', targetSchoolId);

    // Contar transações no banco e quantas ainda precisam de enriquecimento
    const { count: totalInDb } = await supabaseClient
      .from('synced_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', targetSchoolId);

    const { count: pendingCount } = await supabaseClient
      .from('synced_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', targetSchoolId)
      .in('category_name', ['Outras Receitas', 'Outras Despesas']);

    const alreadyEnriched = (totalInDb || 0) - (pendingCount || 0);

    console.log(`[SYNC] DB stats: ${totalInDb} total, ${alreadyEnriched} enriched, ${pendingCount} pending`);

    // Verificar se há checkpoint existente
    const { data: existingCheckpoint } = await supabaseClient
      .from('sync_checkpoints')
      .select('*')
      .eq('school_id', targetSchoolId)
      .maybeSingle();

    // Se resume_only=true e não há pendentes nem checkpoint, retornar que já completou
    if (resume_only && !existingCheckpoint && pendingCount === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          completed: true,
          message: 'Sincronização já foi completada. Todas as transações têm categorias.',
          progress: { 
            processed: totalInDb || 0, 
            total: totalInDb || 0, 
            percentage: 100, 
            successCount: alreadyEnriched,
            pendingCount: 0
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Buscar configuração do Conta Azul
    const { data: config, error: configError } = await supabaseClient
      .from('conta_azul_config')
      .select('id, access_token, refresh_token, expires_at, updated_by')
      .eq('school_id', targetSchoolId)
      .maybeSingle();

    if (configError || !config) {
      throw new Error('Configuração do Conta Azul não encontrada');
    }

    if (!config.access_token || !config.refresh_token) {
      throw new Error('Tokens não encontrados. Por favor, reconecte ao Conta Azul.');
    }

    // Buscar credenciais OAuth da escola
    const { data: oauthCreds, error: credsError } = await supabaseClient
      .from('school_oauth_credentials')
      .select('client_id, client_secret')
      .eq('school_id', targetSchoolId)
      .single();

    if (credsError || !oauthCreds) {
      throw new Error('Credenciais OAuth não configuradas para esta escola');
    }

    let accessToken = config.access_token;

    // Verificar se o token precisa ser atualizado
    const now = new Date();
    const expiresAt = new Date(config.expires_at);
    const bufferTime = 5 * 60 * 1000;

    if (expiresAt.getTime() <= now.getTime() + bufferTime) {
      console.log('[SYNC] Token expired, refreshing...');
      
      const refreshRes = await supabaseClient.functions.invoke("conta-azul-auth", {
        body: { 
          refreshToken: config.refresh_token,
          client_id: oauthCreds.client_id,
          client_secret: oauthCreds.client_secret
        },
      });

      if (refreshRes.error) {
        throw new Error('Os tokens expiraram. Por favor, desconecte e reconecte ao Conta Azul.');
      }

      const tokenData = refreshRes.data;
      accessToken = tokenData.access_token;

      await supabaseClient
        .from('conta_azul_config')
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
          updated_by: user.id,
        })
        .eq('id', config.id);
    }

    // Se há transações pendentes de enriquecimento, processar elas primeiro
    if (pendingCount && pendingCount > 0) {
      console.log(`[SYNC] Processing ${pendingCount} pending transactions for enrichment`);
      
      // Buscar transações pendentes
      const { data: pendingTx } = await supabaseClient
        .from('synced_transactions')
        .select('*')
        .eq('school_id', targetSchoolId)
        .in('category_name', ['Outras Receitas', 'Outras Despesas'])
        .order('external_id');
      
      if (!pendingTx || pendingTx.length === 0) {
        // Sem pendentes, verificar se há checkpoint órfão
        if (existingCheckpoint) {
          await supabaseClient
            .from('sync_checkpoints')
            .delete()
            .eq('school_id', targetSchoolId);
        }
        
        return new Response(
          JSON.stringify({
            success: true,
            completed: true,
            message: 'Todas as transações já foram enriquecidas com categorias.',
            progress: { 
              processed: totalInDb || 0, 
              total: totalInDb || 0, 
              percentage: 100, 
              successCount: alreadyEnriched,
              pendingCount: 0
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Determinar índice inicial
      const startIndex = existingCheckpoint ? (existingCheckpoint.last_processed_index || 0) : 0;

      // Criar/atualizar checkpoint
      if (!existingCheckpoint) {
        await supabaseClient
          .from('sync_checkpoints')
          .upsert({
            school_id: targetSchoolId,
            last_processed_index: 0,
            total_transactions: pendingTx.length,
            success_count: 0,
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }, { onConflict: 'school_id' });
      }

      // Processar transações pendentes
      const result = await enrichPendingTransactions(
        pendingTx,
        accessToken,
        supabaseClient,
        targetSchoolId,
        totalInDb || 0,
        alreadyEnriched,
        startIndex
      );

      const percentage = Math.round((result.processed / pendingTx.length) * 100);

      return new Response(
        JSON.stringify({
          success: true,
          completed: result.completed,
          message: result.completed 
            ? `✅ Enriquecimento completo! ${result.successCount} categorias adicionadas nesta sessão.`
            : `⏳ Enriquecimento em progresso: ${result.processed}/${pendingTx.length} pendentes processadas`,
          progress: {
            processed: result.processed,
            total: pendingTx.length,
            percentage,
            successCount: result.successCount,
            totalInDb: totalInDb || 0,
            alreadyEnriched,
            pendingCount: pendingTx.length - result.processed
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Se resume_only e não há pendentes, já está completo
    if (resume_only) {
      return new Response(
        JSON.stringify({
          success: true,
          completed: true,
          message: 'Sincronização completa. Todas as transações têm categorias reais.',
          progress: { 
            processed: totalInDb || 0, 
            total: totalInDb || 0, 
            percentage: 100, 
            successCount: alreadyEnriched,
            pendingCount: 0
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // NOVA SINCRONIZAÇÃO - buscar dados do Conta Azul
    const startDate = new Date(2025, 3, 1);
    const today = new Date();
    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    console.log('[SYNC] Fetching data from Conta Azul:', formatDate(startDate), 'to', formatDate(today));

    const baseUrl = 'https://api-v2.contaazul.com';

    const fetchAllPages = async (endpoint: string, params: Record<string, string>) => {
      const allItems: any[] = [];
      let page = 1;

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
          if (response.status === 401) {
            throw new Error('Token de acesso inválido. Por favor, reconecte ao Conta Azul.');
          }
          throw new Error(`Erro ao buscar dados: ${response.status}`);
        }

        const data = await response.json();
        const items = data?.itens || [];
        if (items.length === 0) break;

        allItems.push(...items);
        page++;
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      return allItems;
    };

    const params = {
      'data_vencimento_de': formatDate(startDate),
      'data_vencimento_ate': formatDate(today),
    };

    const [receberItems, pagarItems] = await Promise.all([
      fetchAllPages('/v1/financeiro/eventos-financeiros/contas-a-receber/buscar', params),
      fetchAllPages('/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar', params),
    ]);

    console.log(`[SYNC] Fetched ${receberItems.length} receivables, ${pagarItems.length} payables`);

    // Filtrar e mapear
    const filterStatus = (item: any) => 
      ['RECEBIDO', 'ATRASADO', 'EM_ABERTO'].includes(item.status_traduzido);

    const incomeRows = receberItems.filter(filterStatus).map((item: any) => ({
      external_id: `receber_${item.id}`,
      type: 'income',
      amount: item.status_traduzido === 'RECEBIDO' ? (item.pago ?? 0) : (item.total ?? 0),
      description: item.descricao || 'Conta a Receber',
      transaction_date: item.data_vencimento,
      status: item.status_traduzido,
      category_name: 'Outras Receitas',
      category_color: '#22c55e',
      entity_name: item.fornecedor?.nome || null,
      school_id: targetSchoolId,
      raw_data: item,
    }));

    const expenseRows = pagarItems.filter(filterStatus).map((item: any) => ({
      external_id: `pagar_${item.id}`,
      type: 'expense',
      amount: item.status_traduzido === 'RECEBIDO' ? (item.pago ?? 0) : (item.total ?? 0),
      description: item.descricao || 'Conta a Pagar',
      transaction_date: item.data_vencimento,
      status: item.status_traduzido,
      category_name: 'Outras Despesas',
      category_color: '#ef4444',
      entity_name: item.fornecedor?.nome || null,
      school_id: targetSchoolId,
      raw_data: item,
    }));

    const allTransactions = [...incomeRows, ...expenseRows];
    console.log(`[SYNC] Total transactions: ${allTransactions.length}`);

    // Salvar com categorias de fallback
    const { error: upsertError } = await supabaseClient
      .from('synced_transactions')
      .upsert(allTransactions, { onConflict: 'external_id' });

    if (upsertError) throw upsertError;

    // Criar checkpoint inicial para enriquecimento
    await supabaseClient
      .from('sync_checkpoints')
      .upsert({
        school_id: targetSchoolId,
        last_processed_index: 0,
        total_transactions: allTransactions.length,
        success_count: 0,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'school_id' });

    // Iniciar enriquecimento
    const result = await enrichPendingTransactions(
      allTransactions,
      accessToken,
      supabaseClient,
      targetSchoolId,
      allTransactions.length,
      0,
      0
    );

    const percentage = Math.round((result.processed / allTransactions.length) * 100);

    return new Response(
      JSON.stringify({
        success: true,
        completed: result.completed,
        count: allTransactions.length,
        message: result.completed 
          ? `Sincronização completa! ${result.successCount} categorias encontradas.`
          : `Progresso: ${result.processed}/${allTransactions.length} (${percentage}%)`,
        progress: {
          processed: result.processed,
          total: allTransactions.length,
          percentage,
          successCount: result.successCount,
          pendingCount: allTransactions.length - result.processed
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SYNC] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
