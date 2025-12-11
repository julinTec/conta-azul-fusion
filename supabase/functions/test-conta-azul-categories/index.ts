import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CONTA_AZUL_API_BASE = 'https://api-v2.contaazul.com';
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 300;
const TEST_LIMIT = 20; // Testar apenas 20 lançamentos

interface ParcelaDetails {
  id: string;
  descricao: string;
  tipo: string;
  categoria_atual: string;
  nome_categoria_principal: string | null;
  rateio_completo: any;
}

async function buscarCategoriaDaParcela(
  parcelaId: string, 
  accessToken: string
): Promise<{ nome_categoria: string | null; rateio: any }> {
  try {
    const url = `${CONTA_AZUL_API_BASE}/v1/financeiro/eventos-financeiros/parcelas/${parcelaId}`;
    console.log(`Buscando parcela: ${parcelaId}`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`Erro ao buscar parcela ${parcelaId}: ${response.status}`);
      return { nome_categoria: null, rateio: null };
    }

    const data = await response.json();
    
    // Extrair categoria do rateio (primeiro item)
    const rateio = data?.evento?.rateio;
    const nomeCategoria = rateio?.[0]?.nome_categoria || null;
    
    return { nome_categoria: nomeCategoria, rateio };
  } catch (error) {
    console.error(`Erro ao buscar parcela ${parcelaId}:`, error);
    return { nome_categoria: null, rateio: null };
  }
}

async function fetchContasReceber(accessToken: string, limit: number): Promise<any[]> {
  const startDate = '2024-01-01';
  const endDate = new Date().toISOString().split('T')[0];
  
  const url = `${CONTA_AZUL_API_BASE}/v1/contas-a-receber?data_emissao_inicio=${startDate}&data_emissao_fim=${endDate}&size=${limit}`;
  
  console.log(`Buscando contas a receber: ${url}`);
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Erro ao buscar contas a receber: ${response.status} - ${errorText}`);
    return [];
  }

  const data = await response.json();
  return data.items || data || [];
}

async function fetchContasPagar(accessToken: string, limit: number): Promise<any[]> {
  const startDate = '2024-01-01';
  const endDate = new Date().toISOString().split('T')[0];
  
  const url = `${CONTA_AZUL_API_BASE}/v1/contas-a-pagar?data_emissao_inicio=${startDate}&data_emissao_fim=${endDate}&size=${limit}`;
  
  console.log(`Buscando contas a pagar: ${url}`);
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Erro ao buscar contas a pagar: ${response.status} - ${errorText}`);
    return [];
  }

  const data = await response.json();
  return data.items || data || [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verificar autenticação
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Usuário não autenticado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verificar se é admin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Acesso negado - apenas admins' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Obter school_id do body
    const body = await req.json();
    const { school_id } = body;

    if (!school_id) {
      return new Response(JSON.stringify({ error: 'school_id é obrigatório' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Testando categorias para escola: ${school_id}`);

    // Buscar configuração da escola
    const { data: config, error: configError } = await supabase
      .from('conta_azul_config')
      .select('access_token, refresh_token, expires_at')
      .eq('school_id', school_id)
      .single();

    if (configError || !config) {
      return new Response(JSON.stringify({ error: 'Configuração Conta Azul não encontrada para esta escola' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let accessToken = config.access_token;

    // Verificar se token expirou e renovar se necessário
    if (new Date(config.expires_at) <= new Date()) {
      console.log('Token expirado, renovando...');
      
      // Buscar credenciais OAuth da escola
      const { data: oauthCreds } = await supabase
        .from('school_oauth_credentials')
        .select('client_id, client_secret')
        .eq('school_id', school_id)
        .single();

      if (!oauthCreds) {
        return new Response(JSON.stringify({ error: 'Credenciais OAuth não encontradas' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const tokenResponse = await fetch(`${supabaseUrl}/functions/v1/conta-azul-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: config.refresh_token,
          client_id: oauthCreds.client_id,
          client_secret: oauthCreds.client_secret,
        }),
      });

      if (!tokenResponse.ok) {
        return new Response(JSON.stringify({ error: 'Falha ao renovar token' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const tokenData = await tokenResponse.json();
      accessToken = tokenData.access_token;

      // Salvar novos tokens
      await supabase.from('conta_azul_config').upsert({
        school_id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'school_id' });
    }

    // Buscar lançamentos (limitado para teste)
    const halfLimit = Math.floor(TEST_LIMIT / 2);
    const [contasReceber, contasPagar] = await Promise.all([
      fetchContasReceber(accessToken, halfLimit),
      fetchContasPagar(accessToken, halfLimit),
    ]);

    console.log(`Encontrados: ${contasReceber.length} contas a receber, ${contasPagar.length} contas a pagar`);

    // Combinar lançamentos para teste
    const lancamentos = [
      ...contasReceber.slice(0, halfLimit).map(item => ({ ...item, tipo: 'receita' })),
      ...contasPagar.slice(0, halfLimit).map(item => ({ ...item, tipo: 'despesa' })),
    ];

    console.log(`Total de lançamentos para testar: ${lancamentos.length}`);

    // Processar em batches
    const resultados: ParcelaDetails[] = [];
    const categoriasEncontradas: Record<string, number> = {};

    for (let i = 0; i < lancamentos.length; i += BATCH_SIZE) {
      const batch = lancamentos.slice(i, i + BATCH_SIZE);
      
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          const { nome_categoria, rateio } = await buscarCategoriaDaParcela(item.id, accessToken);
          
          // Contar categorias
          if (nome_categoria) {
            categoriasEncontradas[nome_categoria] = (categoriasEncontradas[nome_categoria] || 0) + 1;
          }

          return {
            id: item.id,
            descricao: item.descricao || item.observacoes || 'Sem descrição',
            tipo: item.tipo,
            categoria_atual: item.tipo === 'receita' ? 'Receita' : 'Despesa',
            nome_categoria_principal: nome_categoria,
            rateio_completo: rateio,
          };
        })
      );

      resultados.push(...batchResults);

      // Delay entre batches
      if (i + BATCH_SIZE < lancamentos.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    const comCategoria = resultados.filter(r => r.nome_categoria_principal !== null).length;
    const semCategoria = resultados.filter(r => r.nome_categoria_principal === null).length;

    const response = {
      sucesso: true,
      resumo: {
        total_processado: resultados.length,
        com_categoria: comCategoria,
        sem_categoria: semCategoria,
        taxa_sucesso: `${((comCategoria / resultados.length) * 100).toFixed(1)}%`,
      },
      categorias_encontradas: categoriasEncontradas,
      detalhes: resultados,
    };

    console.log('Teste concluído:', response.resumo);

    return new Response(JSON.stringify(response, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Erro no teste:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
