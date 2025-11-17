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
      let schoolSlug = null;
      if (state) {
        try {
          const stateData = JSON.parse(atob(state));
          schoolId = stateData.schoolId;
        } catch (e) {
          console.error("Error parsing state:", e);
        }
      }

      if (!schoolId) {
        toast.error("Escola não identificada no processo de autenticação");
        navigate("/schools");
        return;
      }

      try {
        setStatus("Obtendo token de acesso...");
        const redirectUri = `${window.location.origin}/auth/callback`;
        
        const { data: tokenData, error } = await supabase.functions.invoke("conta-azul-auth", {
          body: {
            code,
            redirectUri,
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

        // Buscar slug da escola para o redirect final
        const { data: schoolData } = await supabase
          .from('schools')
          .select('slug')
          .eq('id', schoolId)
          .single();
        
        if (schoolData) {
          schoolSlug = schoolData.slug;
        }

        setStatus("Salvando tokens...");

        // Salvar tokens COM school_id
        const { error: saveError } = await supabase.functions.invoke(
          'save-conta-azul-tokens',
          {
            body: {
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expires_in: tokenData.expires_in,
              school_id: schoolId,
            }
          }
        );

        if (saveError) throw saveError;

        toast.success("Conectado ao Conta Azul com sucesso!");
        toast.info("Clique em 'Sincronizar Dados' para atualizar as transações");
        
        // Redirecionar para o dashboard da escola correta
        if (schoolSlug) {
          navigate(`/school/${schoolSlug}/dashboard`);
        } else {
          navigate("/schools");
        }
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
