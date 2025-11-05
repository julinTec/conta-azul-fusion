import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn, RefreshCw, Database, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const CLIENT_ID = "2imfke8a0e9jc4v9qm01r1m9s1";
const REDIRECT_URI = "https://e67bcf1c-e649-449f-b1c3-6b34a01b3f70.lovableproject.com/auth/callback";

export const AdminPanel = () => {
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [hasConnection, setHasConnection] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    verifyAdminAccess();
  }, []);

  const verifyAdminAccess = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setIsAdmin(false);
        return;
      }

      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();

      if (error) {
        console.error('Error verifying admin access:', error);
        setIsAdmin(false);
        return;
      }

      const hasAdminRole = !!data;
      setIsAdmin(hasAdminRole);

      // Only check connection if user is admin
      if (hasAdminRole) {
        checkConnection();
      }
    } catch (error) {
      console.error('Error in verifyAdminAccess:', error);
      setIsAdmin(false);
    }
  };

  const checkConnection = async () => {
    const { data } = await supabase
      .from('conta_azul_config')
      .select('id')
      .limit(1)
      .maybeSingle();
    
    setHasConnection(!!data);
  };

  const handleConnect = () => {
    const authUrl = new URL("https://auth.contaazul.com/oauth2/authorize");
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("client_id", CLIENT_ID);
    authUrl.searchParams.append("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.append("state", crypto.randomUUID());
    authUrl.searchParams.append("scope", "openid profile aws.cognito.signin.user.admin");
    authUrl.searchParams.append("prompt", "login");
    authUrl.searchParams.append("max_age", "0");

    const url = authUrl.toString();

    try {
      if (window.top && window.top !== window) {
        window.top.location.href = url;
        return;
      }
    } catch (_) {
      // Fallback
    }

    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.href = url;
    }
  };

  const handleReconnect = () => {
    // Limpa os tokens antes de redirecionar
    localStorage.removeItem("conta_azul_access_token");
    localStorage.removeItem("conta_azul_refresh_token");
    localStorage.removeItem("conta_azul_token_expires_at");

    const authUrl = new URL("https://auth.contaazul.com/oauth2/authorize");
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("client_id", CLIENT_ID);
    authUrl.searchParams.append("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.append("state", crypto.randomUUID());
    authUrl.searchParams.append("scope", "openid profile aws.cognito.signin.user.admin");
    authUrl.searchParams.append("prompt", "login");
    authUrl.searchParams.append("max_age", "0");

    const url = authUrl.toString();

    try {
      if (window.top && window.top !== window) {
        window.top.location.href = url;
        return;
      }
    } catch (_) {
      // Fallback
    }

    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.href = url;
    }
  };

  const handleDisconnect = async () => {
    try {
      // Limpar localStorage
      localStorage.removeItem("conta_azul_access_token");
      localStorage.removeItem("conta_azul_refresh_token");
      localStorage.removeItem("conta_azul_token_expires_at");

      // Remover configuração do banco
      const { error } = await supabase
        .from('conta_azul_config')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // deleta todos os registros

      if (error) throw error;

      setHasConnection(false);
      toast.success('Conexão removida. Os tokens foram permanentemente apagados do Vault.');
      toast.info('Reconecte para gerar novos tokens seguros.');
    } catch (error: any) {
      console.error('Error disconnecting:', error);
      toast.error('Erro ao desconectar: ' + error.message);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-conta-azul');

      if (error) throw error;

      toast.success(data.message || 'Sincronização concluída!');
      toast.info(`${data.count} transações sincronizadas`);
    } catch (error: any) {
      console.error('Error syncing:', error);
      toast.error(error.message || 'Erro ao sincronizar dados');
    } finally {
      setSyncing(false);
    }
  };

  const handleClearAndResync = async () => {
    setClearing(true);
    try {
      // Primeiro, limpar os dados
      toast.info('Limpando dados antigos...');
      const { error: clearError } = await supabase.functions.invoke('clear-synced-data');

      if (clearError) throw clearError;

      toast.success('Dados limpos com sucesso!');

      // Depois, sincronizar novamente
      toast.info('Iniciando sincronização...');
      setSyncing(true);
      const { data, error: syncError } = await supabase.functions.invoke('sync-conta-azul');

      if (syncError) throw syncError;

      toast.success(data.message || 'Sincronização concluída!');
      toast.info(`${data.count} transações sincronizadas`);
      
      // Recarregar a página para atualizar o gráfico
      setTimeout(() => window.location.reload(), 1500);
    } catch (error: any) {
      console.error('Error clearing and resyncing:', error);
      toast.error(error.message || 'Erro ao limpar e sincronizar dados');
    } finally {
      setClearing(false);
      setSyncing(false);
    }
  };

  // Don't render anything if not admin or still checking
  if (isAdmin === null || isAdmin === false) {
    return null;
  }

  return (
    <Card className="mb-8 border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Painel Administrativo
        </CardTitle>
        <CardDescription>
          Configure a integração com Conta Azul e sincronize os dados
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasConnection ? (
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              Conecte sua conta do Conta Azul para começar a sincronizar os dados financeiros.
            </p>
            <Button onClick={handleConnect} size="lg" className="w-full">
              <LogIn className="mr-2 h-5 w-5" />
              Conectar com Conta Azul
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium text-green-700 dark:text-green-300">
                  Conta Azul conectado
                </span>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleDisconnect} variant="outline" size="sm">
                  <LogOut className="mr-2 h-4 w-4" />
                  Desconectar
                </Button>
                <Button onClick={handleReconnect} variant="outline" size="sm">
                  Reconectar
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Button 
                onClick={handleSync} 
                disabled={syncing || clearing}
                size="lg" 
                className="w-full"
              >
                {syncing ? (
                  <>
                    <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                    Sincronizando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-5 w-5" />
                    Sincronizar
                  </>
                )}
              </Button>

              <Button 
                onClick={handleClearAndResync} 
                disabled={syncing || clearing}
                variant="destructive"
                size="lg" 
                className="w-full"
              >
                {clearing ? (
                  <>
                    <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                    Limpando...
                  </>
                ) : (
                  <>
                    <Database className="mr-2 h-5 w-5" />
                    Limpar e Re-sincronizar
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Use "Limpar e Re-sincronizar" se os valores estiverem incorretos
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
