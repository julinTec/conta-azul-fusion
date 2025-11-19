import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState("Processando autenticação...");

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get("code");
      const state = searchParams.get("state");

      if (!code) {
        toast.error("Código de autorização não encontrado");
        navigate("/schools");
        return;
      }

      // Extrair school_id do state
      let schoolId = null;
      if (state) {
        try {
          const stateData = JSON.parse(atob(state));
          schoolId = stateData.schoolId;
          console.log(`[AuthCallback] Received OAuth callback for school: ${schoolId}`);
        } catch (e) {
          console.error("[AuthCallback] Error parsing state:", e);
          toast.error("Erro ao processar autenticação: state inválido");
          setStatus("Erro ao processar autenticação");
          return;
        }
      }

      if (!schoolId) {
        console.error("[AuthCallback] Missing schoolId in state");
        toast.error("Erro: escola não identificada no callback");
        setStatus("Erro: escola não identificada");
        return;
      }

      try {
        setStatus("Obtendo token de acesso...");
        const redirectUri = `${window.location.origin}/auth/callback`;
        
        // Buscar credenciais OAuth da escola
        const { data: oauthCreds, error: credsError } = await supabase
          .from('school_oauth_credentials')
          .select('client_id, client_secret')
          .eq('school_id', schoolId)
          .single();

        if (credsError || !oauthCreds) {
          console.error("[AuthCallback] Error fetching OAuth credentials:", credsError);
          toast.error("Credenciais OAuth não configuradas para esta escola");
          setStatus("Erro: credenciais não encontradas");
          return;
        }

        const { data: tokenData, error } = await supabase.functions.invoke("conta-azul-auth", {
          body: { 
            code, 
            redirectUri,
            client_id: oauthCreds.client_id,
            client_secret: oauthCreds.client_secret
          },
        });

        if (error) throw error;

        // Verificar se o usuário é admin
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Usuário não autenticado");

        const { data: roles } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle();

        if (!roles) {
          toast.error("Apenas administradores podem conectar ao Conta Azul");
          navigate("/schools");
          return;
        }

        setStatus("Salvando tokens...");

        console.log(`[AuthCallback] Saving tokens for school: ${schoolId}`);
        const { error: saveError } = await supabase.functions.invoke('save-conta-azul-tokens', {
          body: {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: tokenData.expires_in,
            school_id: schoolId,
          }
        });

        if (saveError) {
          console.error("[AuthCallback] Error saving tokens:", saveError);
          throw saveError;
        }

        console.log(`[AuthCallback] Tokens saved successfully`);

        const { data: finalSchoolData, error: schoolError } = await supabase
          .from('schools')
          .select('slug, name')
          .eq('id', schoolId)
          .single();
        
        if (schoolError || !finalSchoolData) {
          console.error("[AuthCallback] Error fetching school:", schoolError);
          toast.error("Erro ao buscar dados da escola");
          return;
        }

        console.log(`[AuthCallback] Redirecting to: ${finalSchoolData.name}`);
        toast.success(`Conta Azul conectado para ${finalSchoolData.name}!`);
        toast.info("Clique em 'Sincronizar Dados' para atualizar");
        navigate(`/school/${finalSchoolData.slug}/dashboard`);
      } catch (error: any) {
        console.error("Error during authentication:", error);
        toast.error(error.message || "Erro ao conectar com Conta Azul");
        navigate("/schools");
      }
    };

    handleCallback();
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <div className="text-center space-y-4">
        <Loader2 className="h-12 w-12 animate-spin mx-auto text-primary" />
        <p className="text-lg text-muted-foreground">{status}</p>
      </div>
    </div>
  );
}
