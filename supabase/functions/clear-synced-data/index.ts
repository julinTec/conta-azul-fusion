import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verificar autenticação
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) {
      console.error('Authentication error:', userError);
      return new Response(
        JSON.stringify({ error: 'Não autenticado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verificar se é admin
    const { data: roleData, error: roleError } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError || !roleData) {
      console.error('Role check error:', roleError);
      return new Response(
        JSON.stringify({ error: 'Acesso negado. Apenas administradores podem limpar os dados.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Receber school_id do body
    const body = await req.json();
    const { school_id } = body;

    let deleteQuery = supabaseClient
      .from('synced_transactions')
      .delete();

    // Se school_id fornecido, deletar apenas dessa escola
    if (school_id) {
      deleteQuery = deleteQuery.eq('school_id', school_id);
      console.log('Clearing data for school_id:', school_id);
    } else {
      // Caso contrário, deletar tudo (compatibilidade)
      deleteQuery = deleteQuery.neq('id', '00000000-0000-0000-0000-000000000000');
      console.log('Clearing all data');
    }

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      console.error('Error deleting synced_transactions:', deleteError);
      throw deleteError;
    }

    console.log('Successfully cleared synced_transactions');

    return new Response(
      JSON.stringify({ 
        message: 'Dados sincronizados limpos com sucesso',
        success: true 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('Error in clear-synced-data function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
