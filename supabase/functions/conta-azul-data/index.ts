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
    
    // Fetch contas a receber (income)
    const receberUrl = new URL(`${baseUrl}/v1/financeiro/eventos-financeiros/contas-a-receber/buscar`);
    receberUrl.searchParams.append('data_competencia_de', startDate);
    receberUrl.searchParams.append('data_competencia_ate', endDate);
    receberUrl.searchParams.append('tamanho_pagina', '100');

    console.log('Fetching contas a receber:', receberUrl.toString());

    const receberResponse = await fetch(receberUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // Fetch contas a pagar (expenses)
    const pagarUrl = new URL(`${baseUrl}/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar`);
    pagarUrl.searchParams.append('data_competencia_de', startDate);
    pagarUrl.searchParams.append('data_competencia_ate', endDate);
    pagarUrl.searchParams.append('tamanho_pagina', '100');

    console.log('Fetching contas a pagar:', pagarUrl.toString());

    const pagarResponse = await fetch(pagarUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!receberResponse.ok || !pagarResponse.ok) {
      const receberError = !receberResponse.ok ? await receberResponse.text() : null;
      const pagarError = !pagarResponse.ok ? await pagarResponse.text() : null;
      console.error('API errors:', { receberError, pagarError });
      throw new Error('Failed to fetch data from Conta Azul API');
    }

    const receberData = await receberResponse.json();
    const pagarData = await pagarResponse.json();

    console.log('Successfully fetched data:', {
      receber: receberData?.itens?.length || 0,
      pagar: pagarData?.itens?.length || 0,
    });

    return new Response(
      JSON.stringify({
        contasAReceber: receberData?.itens || [],
        contasAPagar: pagarData?.itens || [],
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
