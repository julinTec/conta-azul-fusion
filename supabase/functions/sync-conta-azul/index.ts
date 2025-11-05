import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to get decrypted token from Vault
async function getDecryptedToken(supabase: any, secretId: string): Promise<string> {
  const { data, error } = await supabase
    .from('vault.decrypted_secrets')
    .select('decrypted_secret')
    .eq('id', secretId)
    .single();
  
  if (error) throw new Error(`Failed to decrypt token: ${error.message}`);
  return data.decrypted_secret;
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

    // Buscar configuração do Conta Azul (agora com secret IDs)
    const { data: config, error: configError } = await supabaseClient
      .from('conta_azul_config')
      .select('id, access_token_secret_id, refresh_token_secret_id, expires_at, updated_by')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (configError || !config) {
      throw new Error('Configuração do Conta Azul não encontrada');
    }

    if (!config.access_token_secret_id || !config.refresh_token_secret_id) {
      throw new Error('Tokens não encontrados no Vault. Por favor, reconecte ao Conta Azul.');
    }

    console.log('Loading tokens from Vault...');

    // Buscar tokens descriptografados do Vault
    let accessToken = await getDecryptedToken(supabaseClient, config.access_token_secret_id);
    let refreshToken = await getDecryptedToken(supabaseClient, config.refresh_token_secret_id);

    // Verificar se o token precisa ser atualizado
    const now = new Date();
    const expiresAt = new Date(config.expires_at);

    if (expiresAt <= now) {
      console.log('Token expired, refreshing...');
      
      // Refresh token
      const clientId = Deno.env.get('CONTA_AZUL_CLIENT_ID');
      const clientSecret = Deno.env.get('CONTA_AZUL_CLIENT_SECRET');

      const tokenResponse = await fetch('https://auth.contaazul.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId!,
          client_secret: clientSecret!,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Falha ao atualizar token');
      }

      const tokenData = await tokenResponse.json();
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token;

      console.log('Updating tokens in Vault...');

      // Atualizar secrets no Vault
      await supabaseClient.from('vault.secrets')
        .update({ secret: tokenData.access_token })
        .eq('id', config.access_token_secret_id);

      await supabaseClient.from('vault.secrets')
        .update({ secret: tokenData.refresh_token })
        .eq('id', config.refresh_token_secret_id);

      // Atualizar apenas o expires_at na config
      await supabaseClient
        .from('conta_azul_config')
        .update({
          expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
          updated_by: user.id,
        })
        .eq('id', config.id);

      console.log('Tokens refreshed and saved to Vault');
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
          throw new Error(`Failed to fetch data: ${response.status}`);
        }

        const data = await response.json();
        const items = data?.itens || [];
        if (items.length === 0) break;

        allItems.push(...items);
        page++;
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

    // Filtrar apenas itens com status "RECEBIDO"
    const filteredReceberItems = receberItems.filter((item: any) => 
      item.status_traduzido === 'RECEBIDO'
    );
    const filteredPagarItems = pagarItems.filter((item: any) => 
      item.status_traduzido === 'RECEBIDO'
    );

    // Mapear para o formato da tabela
    const transactions = [
      ...filteredReceberItems.map((item: any) => ({
        external_id: `receber_${item.id}`,
        type: 'income',
        amount: item.pago ?? 0,
        description: item.descricao || 'Conta a Receber',
        transaction_date: item.data_vencimento,
        status: item.status_traduzido,
        category_name: 'Receita',
        category_color: '#22c55e',
        entity_name: item.fornecedor?.nome || null,
        raw_data: item,
      })),
      ...filteredPagarItems.map((item: any) => ({
        external_id: `pagar_${item.id}`,
        type: 'expense',
        amount: item.pago ?? 0,
        description: item.descricao || 'Conta a Pagar',
        transaction_date: item.data_vencimento,
        status: item.status_traduzido,
        category_name: 'Despesa',
        category_color: '#ef4444',
        entity_name: item.fornecedor?.nome || null,
        raw_data: item,
      })),
    ];

    console.log('=== SYNC DEBUG ===');
    console.log('Total transactions to sync:', transactions.length);
    console.log('Sample transactions (first 3):', transactions.slice(0, 3).map(t => ({
      id: t.external_id,
      type: t.type,
      amount: t.amount,
      date: t.transaction_date,
      status: t.status
    })));
    
    // Log totals by month
    const monthlyTotals = transactions.reduce((acc: any, t: any) => {
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
      .upsert(transactions, { onConflict: 'external_id' });

    if (upsertError) {
      throw upsertError;
    }

    console.log(`Successfully synced ${transactions.length} transactions`);

    return new Response(
      JSON.stringify({
        success: true,
        count: transactions.length,
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