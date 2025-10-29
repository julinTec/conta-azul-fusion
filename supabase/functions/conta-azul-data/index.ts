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
    
    // Helper function to fetch all pages
    const fetchAllPages = async (endpoint: string, params: Record<string, string>) => {
      const allItems: any[] = [];
      let page = 1;
      
      while (true) {
        const url = new URL(`${baseUrl}${endpoint}`);
        Object.entries({ ...params, pagina: page.toString(), tamanho_pagina: '100' }).forEach(([key, value]) => {
          url.searchParams.append(key, value);
        });

        console.log(`Fetching page ${page}:`, url.toString());

        const response = await fetch(url.toString(), {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`API error on page ${page}:`, errorText);
          throw new Error(`Failed to fetch data: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const items = data?.itens || [];
        
        if (items.length === 0) {
          break;
        }

        allItems.push(...items);
        console.log(`Page ${page} fetched: ${items.length} items`);
        page++;
      }

      return allItems;
    };

    // Fetch contas a receber (income) - all pages
    const receberItems = await fetchAllPages(
      '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar',
      {
        'data_vencimento_de': startDate,
        'data_vencimento_ate': endDate,
      }
    );

    // Fetch contas a pagar (expenses) - all pages
    const pagarItems = await fetchAllPages(
      '/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar',
      {
        'data_vencimento_de': startDate,
        'data_vencimento_ate': endDate,
      }
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
