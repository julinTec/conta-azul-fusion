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

// Busca categoria real de uma transação via API de parcelas
async function fetchCategoryForTransaction(
  parcelaId: string, 
  accessToken: string
): Promise<string | null> {
  try {
    const url = `${CONTA_AZUL_API_BASE}/v1/financeiro/eventos-financeiros/parcelas/${parcelaId}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.evento?.rateio?.[0]?.nome_categoria || null;
  } catch (error) {
    console.error(`Error fetching category for ${parcelaId}:`, error);
    return null;
  }
}

// Enriquece transações com categorias reais - OTIMIZADO: lotes de 10, delay de 150ms
async function enrichTransactionsWithCategories(
  transactions: any[], 
  accessToken: string
): Promise<any[]> {
  const batchSize = 10; // Aumentado de 5 para 10
  const delayMs = 150; // Reduzido de 300ms para 150ms
  
  console.log(`[ENRICH] Starting enrichment of ${transactions.length} transactions...`);
  let categoriesFound = 0;
  let errors = 0;
  
  for (let i = 0; i < transactions.length; i += batchSize) {
    const batch = transactions.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (tx) => {
      try {
        const parcelaId = tx.external_id.replace(/^(receber_|pagar_)/, '');
        const categoria = await fetchCategoryForTransaction(parcelaId, accessToken);
        
        if (categoria) {
          tx.category_name = categoria;
          categoriesFound++;
        }
      } catch (err) {
        errors++;
      }
    }));
    
    // Log a cada 100 transações
    if ((i + batchSize) % 100 === 0 || i + batchSize >= transactions.length) {
      console.log(`[ENRICH] Progress: ${Math.min(i + batchSize, transactions.length)}/${transactions.length} (${categoriesFound} categories found, ${errors} errors)`);
    }
    
    // Delay entre lotes
    if (i + batchSize < transactions.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  console.log(`[ENRICH] Complete: ${categoriesFound}/${transactions.length} with real categories, ${errors} errors`);
  return transactions;
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
    const { school_id } = body;

    // Buscar escola padrão se não fornecido (compatibilidade)
    let targetSchoolId = school_id;
    if (!targetSchoolId) {
      console.log('No school_id provided, using Paulo Freire as default');
      const { data: defaultSchool } = await supabaseClient
        .from('schools')
        .select('id')
        .eq('slug', 'paulo-freire')
        .single();
      targetSchoolId = defaultSchool?.id;
    }

    console.log('[SYNC] Starting sync for school_id:', targetSchoolId);

    // Buscar configuração do Conta Azul DESTA ESCOLA
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

    console.log('[SYNC] Loading tokens from database...');

    // Tokens agora vêm diretamente da tabela
    let accessToken = config.access_token;
    let refreshToken = config.refresh_token;

    // Verificar se o token precisa ser atualizado (com buffer de 5 minutos)
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
        console.error('[SYNC] Token refresh failed:', refreshRes.error);
        throw new Error('Os tokens expiraram. Por favor, desconecte e reconecte ao Conta Azul no painel administrativo.');
      }

      const tokenData = refreshRes.data;
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token;

      await supabaseClient
        .from('conta_azul_config')
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
          updated_by: user.id,
        })
        .eq('id', config.id);

      console.log('[SYNC] Tokens refreshed and saved');
    }

    // Buscar dados desde abril de 2025
    const startDate = new Date(2025, 3, 1);
    const today = new Date();
    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    console.log('[SYNC] Fetching data from Conta Azul:', formatDate(startDate), 'to', formatDate(today));

    const baseUrl = 'https://api-v2.contaazul.com';

    // Função para buscar todas as páginas
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
          const errorText = await response.text();
          console.error(`[SYNC] Conta Azul fetch failed ${response.status}:`, errorText);
          if (response.status === 401) {
            throw new Error('Token de acesso inválido. Por favor, desconecte e reconecte ao Conta Azul no painel administrativo.');
          }
          throw new Error(`Erro ao buscar dados do Conta Azul: ${response.status}`);
        }

        const data = await response.json();
        const items = data?.itens || [];
        if (items.length === 0) break;

        allItems.push(...items);
        page++;
        
        if (items.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      return allItems;
    };

    const params = {
      'data_vencimento_de': formatDate(startDate),
      'data_vencimento_ate': formatDate(today),
    };

    // Buscar contas a receber e a pagar
    const [receberItems, pagarItems] = await Promise.all([
      fetchAllPages('/v1/financeiro/eventos-financeiros/contas-a-receber/buscar', params),
      fetchAllPages('/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar', params),
    ]);

    console.log(`[SYNC] Fetched ${receberItems.length} receivables, ${pagarItems.length} payables`);

    // Filtrar itens com status relevantes
    const filteredReceberItems = receberItems.filter((item: any) => 
      item.status_traduzido === 'RECEBIDO' || item.status_traduzido === 'ATRASADO' || item.status_traduzido === 'EM_ABERTO'
    );
    const filteredPagarItems = pagarItems.filter((item: any) => 
      item.status_traduzido === 'RECEBIDO' || item.status_traduzido === 'ATRASADO' || item.status_traduzido === 'EM_ABERTO'
    );

    // Mapear para o formato da tabela com fallback
    const incomeRows = filteredReceberItems.map((item: any) => ({
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

    const expenseRows = filteredPagarItems.map((item: any) => ({
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
    console.log(`[SYNC] Total transactions to process: ${allTransactions.length}`);

    // FASE 1: Salvar imediatamente com categorias de fallback
    console.log('[SYNC] Phase 1: Saving transactions with fallback categories...');
    const { error: upsertError } = await supabaseClient
      .from('synced_transactions')
      .upsert(allTransactions, { onConflict: 'external_id' });

    if (upsertError) {
      console.error('[SYNC] Upsert error:', upsertError);
      throw upsertError;
    }

    console.log(`[SYNC] Phase 1 complete: ${allTransactions.length} transactions saved with fallback categories`);

    // FASE 2: Enriquecer com categorias reais em BACKGROUND
    const backgroundEnrichment = async () => {
      try {
        console.log('[BACKGROUND] Starting category enrichment...');
        const enrichedTransactions = await enrichTransactionsWithCategories(allTransactions, accessToken);
        
        // Salvar transações enriquecidas
        const { error: enrichError } = await supabaseClient
          .from('synced_transactions')
          .upsert(enrichedTransactions, { onConflict: 'external_id' });

        if (enrichError) {
          console.error('[BACKGROUND] Enrichment upsert error:', enrichError);
        } else {
          console.log(`[BACKGROUND] Complete: ${enrichedTransactions.length} transactions enriched with real categories`);
        }
      } catch (err) {
        console.error('[BACKGROUND] Enrichment failed:', err);
      }
    };

    // Iniciar enriquecimento em background sem esperar
    EdgeRuntime.waitUntil(backgroundEnrichment());

    // Retornar resposta imediata
    return new Response(
      JSON.stringify({
        success: true,
        count: allTransactions.length,
        message: `Sincronização iniciada! ${allTransactions.length} transações salvas. Categorias sendo processadas em segundo plano.`,
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
