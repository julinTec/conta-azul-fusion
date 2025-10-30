import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { accessToken, startDate, endDate } = await req.json();

    if (!accessToken) {
      throw new Error('Access token is required');
    }

    console.log('Fetching Conta Azul data from', startDate, 'to', endDate);

    const baseUrl = 'https://api-v2.contaazul.com';

    // Helper function para buscar todas as páginas de um endpoint
    const fetchAllPages = async (endpoint: string, params: Record<string, string>, tipo: 'pagar' | 'receber') => {
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
          throw new Error(`Failed to fetch data: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const itemsRaw = data?.itens || [];
        if (itemsRaw.length === 0) break;

        // Mapear campos corretamente
        const itemsMapped = itemsRaw.map((item: any) => ({
          id: item.id,
          descricao: item.descricao,
          entidade: item.fornecedor?.nome || null, // fornecedor ou cliente
          data_vencimento: item.data_vencimento,
          status: item.status_traduzido,
          total: item.total || 0,
          pago: item.pago || 0,
          nao_pago: item.nao_pago || 0,
          tipo: tipo // para diferenciar no dashboard
        }));

        allItems.push(...itemsMapped);
        page++;
      }

      return allItems;
    };

    // Parâmetros de filtro de datas
    const params = {
      'data_vencimento_de': startDate,
      'data_vencimento_ate': endDate,
    };

    // Buscar contas a receber
    const receberItems = await fetchAllPages(
      '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar',
      params,
      'receber'
    );

    // Buscar contas a pagar
    const pagarItems = await fetchAllPages(
      '/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar',
      params,
      'pagar'
    );

    console.log('Successfully fetched all data:', {
      receber: receberItems.length,
      pagar: pagarItems.length,
    });

    return new Response(
      JSON.stringify({
        contasAReceber: receberItems,
        contasAPagar: pagarItems,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in conta-azul-data:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
