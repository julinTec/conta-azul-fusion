import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

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

// Enriquece transações com categorias reais em lotes de 5 com delay de 300ms
async function enrichTransactionsWithCategories(
  transactions: any[], 
  accessToken: string
): Promise<any[]> {
  const batchSize = 5;
  const delayMs = 300;
  
  console.log(`Enriching ${transactions.length} transactions with real categories...`);
  let categoriesFound = 0;
  
  for (let i = 0; i < transactions.length; i += batchSize) {
    const batch = transactions.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (tx) => {
      // Extrair ID do external_id (formato: "receber_{id}" ou "pagar_{id}")
      const parcelaId = tx.external_id.replace(/^(receber_|pagar_)/, '');
      const categoria = await fetchCategoryForTransaction(parcelaId, accessToken);
      
      if (categoria) {
        tx.category_name = categoria;
        categoriesFound++;
      }
      // Se não encontrou, mantém o fallback já definido
    }));
    
    // Delay entre lotes para não sobrecarregar a API
    if (i + batchSize < transactions.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  console.log(`Categories enrichment complete: ${categoriesFound}/${transactions.length} transactions with real categories`);
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

    console.log('Syncing for school_id:', targetSchoolId);

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

    console.log('Loading tokens from database...');

    // Tokens agora vêm diretamente da tabela
    let accessToken = config.access_token;
    let refreshToken = config.refresh_token;

    // Verificar se o token precisa ser atualizado (com buffer de 5 minutos)
    const now = new Date();
    const expiresAt = new Date(config.expires_at);
    const bufferTime = 5 * 60 * 1000; // 5 minutos em milissegundos

    if (expiresAt.getTime() <= now.getTime() + bufferTime) {
      console.log('Token expired, refreshing...');
      
      // Usar o edge function conta-azul-auth com credenciais da escola
      const refreshRes = await supabaseClient.functions.invoke("conta-azul-auth", {
        body: { 
          refreshToken: config.refresh_token,
          client_id: oauthCreds.client_id,
          client_secret: oauthCreds.client_secret
        },
      });

      if (refreshRes.error) {
        console.error('Token refresh failed:', refreshRes.error);
        throw new Error('Os tokens expiraram. Por favor, desconecte e reconecte ao Conta Azul no painel administrativo.');
      }

      const tokenData = refreshRes.data;
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token;

      console.log('Updating tokens in database...');

      // Atualizar tokens diretamente na config
      await supabaseClient
        .from('conta_azul_config')
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
          updated_by: user.id,
        })
        .eq('id', config.id);

      console.log('Tokens refreshed and saved to database');
    }

    // Buscar dados desde abril de 2025
    const startDate = new Date(2025, 3, 1); // 1º de abril de 2025
    const today = new Date();

    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    console.log('Fetching data from Conta Azul:', {
      from: formatDate(startDate),
      to: formatDate(today)
    });

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
          console.error(`Conta Azul fetch failed ${response.status}:`, errorText);
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
        
        // Delay para respeitar rate limiting da API
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

    // Filtrar itens com status relevantes
    const filteredReceberItems = receberItems.filter((item: any) => 
      item.status_traduzido === 'RECEBIDO' || item.status_traduzido === 'ATRASADO' || item.status_traduzido === 'EM_ABERTO'
    );
    const filteredPagarItems = pagarItems.filter((item: any) => 
      item.status_traduzido === 'RECEBIDO' || item.status_traduzido === 'ATRASADO' || item.status_traduzido === 'EM_ABERTO'
    );

    // Mapear para o formato da tabela com fallback "Outras Receitas" / "Outras Despesas"
    const incomeRows = filteredReceberItems.map((item: any) => ({
      external_id: `receber_${item.id}`,
      type: 'income',
      amount: item.status_traduzido === 'RECEBIDO' ? (item.pago ?? 0) : (item.total ?? 0),
      description: item.descricao || 'Conta a Receber',
      transaction_date: item.data_vencimento,
      status: item.status_traduzido,
      category_name: 'Outras Receitas', // Fallback - será substituído se encontrar categoria real
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
      category_name: 'Outras Despesas', // Fallback - será substituído se encontrar categoria real
      category_color: '#ef4444',
      entity_name: item.fornecedor?.nome || null,
      school_id: targetSchoolId,
      raw_data: item,
    }));

    // Enriquecer com categorias reais do Conta Azul
    const allTransactions = [...incomeRows, ...expenseRows];
    const enrichedTransactions = await enrichTransactionsWithCategories(allTransactions, accessToken);

    console.log('=== SYNC DEBUG ===');
    console.log('Total transactions to sync:', enrichedTransactions.length);
    console.log('Sample transactions (first 3):', enrichedTransactions.slice(0, 3).map(t => ({
      id: t.external_id,
      type: t.type,
      amount: t.amount,
      date: t.transaction_date,
      status: t.status,
      category: t.category_name
    })));
    
    // Log totals by month
    const monthlyTotals = enrichedTransactions.reduce((acc: any, t: any) => {
      const month = t.transaction_date.substring(0, 7);
      if (!acc[month]) acc[month] = { income: 0, expense: 0 };
      if (t.type === 'income') acc[month].income += Number(t.amount);
      if (t.type === 'expense') acc[month].expense += Number(t.amount);
      return acc;
    }, {});
    console.log('Monthly totals:', monthlyTotals);

    // Inserir/atualizar transações no banco (upsert)
    const { error: upsertError } = await supabaseClient
      .from('synced_transactions')
      .upsert(enrichedTransactions, { onConflict: 'external_id' });

    if (upsertError) {
      throw upsertError;
    }

    console.log(`Successfully synced ${enrichedTransactions.length} transactions`);

    return new Response(
      JSON.stringify({
        success: true,
        count: enrichedTransactions.length,
        message: 'Sincronização concluída com sucesso',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in sync-conta-azul:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
