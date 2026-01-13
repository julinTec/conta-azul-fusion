import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn, RefreshCw, Database, LogOut, Tags, XCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSchool } from "@/contexts/SchoolContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";

const REDIRECT_URI = "https://vvabffebndtzellpnomq.lovable.app/auth/callback";

type SyncStatus = 'idle' | 'syncing' | 'waiting' | 'completed' | 'error';

interface SyncProgress {
  processed: number;
  total: number;
  percentage: number;
  successCount: number;
}

export const AdminPanel = () => {
  const { school } = useSchool();
  const [syncing, setSyncing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [hasConnection, setHasConnection] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [oauthCredentials, setOauthCredentials] = useState<{
    client_id: string;
    client_secret: string;
  } | null>(null);
  const [syncStats, setSyncStats] = useState<{
    lastSync: string | null;
    minDate: string | null;
    maxDate: string | null;
    totalTransactions: number;
    totalIncome: number;
    totalExpense: number;
  } | null>(null);
  const [testingCategories, setTestingCategories] = useState(false);
  const [categoryTestResults, setCategoryTestResults] = useState<{
    summary: {
      totalProcessed: number;
      successRate: string;
      categoriesFound: number;
      categoryCounts: Record<string, number>;
    };
    results: Array<{
      id: string;
      descricao: string;
      tipo: string;
      categoria_atual: string;
      nome_categoria_principal: string;
    }>;
  } | null>(null);

  // Auto-retry state
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [waitCountdown, setWaitCountdown] = useState(0);
  const cancelRef = useRef(false);

  useEffect(() => {
    verifyAdminAccess();
  }, [school?.id]);

  // Verificar checkpoint ao carregar
  useEffect(() => {
    if (isAdmin && school?.id) {
      checkExistingCheckpoint();
    }
  }, [isAdmin, school?.id]);

  const checkExistingCheckpoint = async () => {
    if (!school?.id) return;
    
    const { data } = await supabase
      .from('sync_checkpoints')
      .select('*')
      .eq('school_id', school.id)
      .maybeSingle();
    
    if (data) {
      setSyncProgress({
        processed: data.last_processed_index,
        total: data.total_transactions,
        percentage: Math.round((data.last_processed_index / data.total_transactions) * 100),
        successCount: data.success_count || 0
      });
      toast.info(`Sincronização pendente: ${data.last_processed_index}/${data.total_transactions}. Clique em "Continuar" para retomar.`);
    }
  };

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

      if (hasAdminRole) {
        checkConnection();
        loadSyncStats();
      }
    } catch (error) {
      console.error('Error in verifyAdminAccess:', error);
      setIsAdmin(false);
    }
  };

  const checkConnection = async () => {
    if (!school?.id) {
      setHasConnection(false);
      setOauthCredentials(null);
      return;
    }

    const { data } = await supabase
      .from('conta_azul_config')
      .select('access_token, refresh_token')
      .eq('school_id', school.id)
      .maybeSingle();
    
    const { data: credsData } = await supabase
      .from('school_oauth_credentials')
      .select('client_id, client_secret')
      .eq('school_id', school.id)
      .maybeSingle();
    
    setOauthCredentials(credsData);
    setHasConnection(!!(data?.access_token && data?.refresh_token));
  };

  const loadSyncStats = async () => {
    try {
      let query = supabase
        .from('synced_transactions')
        .select('transaction_date, amount, type, synced_at');
      
      if (school?.id) {
        query = query.eq('school_id', school.id);
      }
      
      const { data, error } = await query;

      if (error) throw error;

      if (!data || data.length === 0) {
        setSyncStats(null);
        return;
      }

      const dates = data.map(t => t.transaction_date).sort();
      const lastSync = data.reduce((latest, t) => 
        !latest || new Date(t.synced_at) > new Date(latest) ? t.synced_at : latest, 
        null as string | null
      );

      const totalIncome = data
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      const totalExpense = data
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + Number(t.amount), 0);

      setSyncStats({
        lastSync,
        minDate: dates[0] || null,
        maxDate: dates[dates.length - 1] || null,
        totalTransactions: data.length,
        totalIncome,
        totalExpense,
      });
    } catch (error) {
      console.error('Error loading sync stats:', error);
    }
  };

  const handleConnect = () => {
    if (!school?.id) {
      toast.error("Escola não identificada");
      return;
    }

    if (!oauthCredentials) {
      toast.error("Credenciais OAuth não configuradas para esta escola");
      return;
    }

    const authUrl = new URL("https://auth.contaazul.com/oauth2/authorize");
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("client_id", oauthCredentials.client_id);
    authUrl.searchParams.append("redirect_uri", REDIRECT_URI);
    
    const stateData = {
      uuid: crypto.randomUUID(),
      schoolId: school.id
    };
    authUrl.searchParams.append("state", btoa(JSON.stringify(stateData)));
    
    authUrl.searchParams.append("scope", "openid profile aws.cognito.signin.user.admin");
    authUrl.searchParams.append("prompt", "login");
    authUrl.searchParams.append("max_age", "0");

    const url = authUrl.toString();

    try {
      if (window.top && window.top !== window) {
        window.top.location.href = url;
        return;
      }
    } catch (_) {}

    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.href = url;
    }
  };

  const handleReconnect = () => {
    if (!school?.id) {
      toast.error("Escola não identificada");
      return;
    }

    if (!oauthCredentials) {
      toast.error("Credenciais OAuth não configuradas para esta escola");
      return;
    }

    localStorage.removeItem("conta_azul_access_token");
    localStorage.removeItem("conta_azul_refresh_token");
    localStorage.removeItem("conta_azul_token_expires_at");

    const authUrl = new URL("https://auth.contaazul.com/oauth2/authorize");
    authUrl.searchParams.append("response_type", "code");
    authUrl.searchParams.append("client_id", oauthCredentials.client_id);
    authUrl.searchParams.append("redirect_uri", REDIRECT_URI);
    
    const stateData = {
      uuid: crypto.randomUUID(),
      schoolId: school.id
    };
    authUrl.searchParams.append("state", btoa(JSON.stringify(stateData)));
    
    authUrl.searchParams.append("scope", "openid profile aws.cognito.signin.user.admin");
    authUrl.searchParams.append("prompt", "login");
    authUrl.searchParams.append("max_age", "0");

    const url = authUrl.toString();

    try {
      if (window.top && window.top !== window) {
        window.top.location.href = url;
        return;
      }
    } catch (_) {}

    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.href = url;
    }
  };

  const handleDisconnect = async () => {
    try {
      if (!school?.id) {
        toast.error("Escola não identificada");
        return;
      }

      localStorage.removeItem("conta_azul_access_token");
      localStorage.removeItem("conta_azul_refresh_token");
      localStorage.removeItem("conta_azul_token_expires_at");

      const { error } = await supabase
        .from('conta_azul_config')
        .delete()
        .eq('school_id', school.id);

      if (error) throw error;

      setHasConnection(false);
      toast.success('Conexão removida para esta escola.');
    } catch (error: any) {
      console.error('Error disconnecting:', error);
      toast.error('Erro ao desconectar: ' + error.message);
    }
  };

  // Auto-retry sync with countdown
  const handleAutoSync = async (resumeOnly: boolean = false) => {
    cancelRef.current = false;
    setSyncStatus('syncing');
    setSyncing(true);

    while (!cancelRef.current) {
      try {
        const { data, error } = await supabase.functions.invoke('sync-conta-azul', {
          body: { school_id: school?.id, resume_only: resumeOnly }
        });

        if (error) throw error;

        setSyncProgress(data.progress);

        if (data.completed) {
          setSyncStatus('completed');
          setSyncing(false);
          toast.success(data.message || 'Sincronização completa!');
          await loadSyncStats();
          break;
        }

        // Não completou, aguardar e continuar
        setSyncStatus('waiting');
        
        // Countdown de 10 segundos
        for (let i = 10; i > 0; i--) {
          if (cancelRef.current) break;
          setWaitCountdown(i);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (cancelRef.current) {
          setSyncStatus('idle');
          setSyncing(false);
          toast.info('Sincronização pausada. Você pode continuar depois.');
          break;
        }

        setSyncStatus('syncing');
        resumeOnly = true; // Próximas iterações são continuações

      } catch (error: any) {
        console.error('Error syncing:', error);
        setSyncStatus('error');
        setSyncing(false);
        toast.error(error.message || 'Erro ao sincronizar');
        break;
      }
    }
  };

  const handleCancelSync = () => {
    cancelRef.current = true;
    toast.info('Cancelando sincronização...');
  };

  const handleClearAndResync = async () => {
    setClearing(true);
    try {
      toast.info('Limpando dados antigos...');
      
      // Limpar checkpoint também
      if (school?.id) {
        await supabase
          .from('sync_checkpoints')
          .delete()
          .eq('school_id', school.id);
      }
      
      const { error: clearError } = await supabase.functions.invoke('clear-synced-data', {
        body: { school_id: school?.id }
      });

      if (clearError) throw clearError;

      toast.success('Dados limpos com sucesso!');
      setSyncProgress(null);

      // Iniciar nova sincronização
      setClearing(false);
      handleAutoSync(false);
      
    } catch (error: any) {
      console.error('Error clearing:', error);
      toast.error(error.message || 'Erro ao limpar dados');
      setClearing(false);
    }
  };

  const handleTestCategories = async () => {
    setTestingCategories(true);
    setCategoryTestResults(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('test-conta-azul-categories', {
        body: { school_id: school?.id }
      });

      if (error) throw error;

      setCategoryTestResults(data);
      toast.success(`Teste concluído! ${data.summary.totalProcessed} transações analisadas.`);
    } catch (error: any) {
      console.error('Error testing categories:', error);
      toast.error(error.message || 'Erro ao testar categorias');
    } finally {
      setTestingCategories(false);
    }
  };

  if (isAdmin === null || isAdmin === false) {
    return null;
  }

  const isBusy = syncing || clearing || syncStatus === 'syncing' || syncStatus === 'waiting';
  const hasPendingSync = syncProgress && syncProgress.percentage < 100 && syncStatus === 'idle';

  return (
    <>
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
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground mb-4">
                Conecte sua conta do Conta Azul para começar a sincronizar os dados financeiros.
              </p>
              <Button onClick={handleConnect} size="lg" className="w-full">
                <LogIn className="mr-2 h-5 w-5" />
                Conectar com Conta Azul
              </Button>
              <Button onClick={handleReconnect} variant="outline" size="sm" className="w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Forçar Nova Autenticação
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

              {syncStats && (
                <Card className="bg-card/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Status da Sincronização</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Última sincronização</p>
                        <p className="font-medium">
                          {syncStats.lastSync 
                            ? new Date(syncStats.lastSync).toLocaleString('pt-BR')
                            : 'Nunca'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Total de transações</p>
                        <p className="font-medium">{syncStats.totalTransactions}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Período dos dados</p>
                        <p className="font-medium">
                          {syncStats.minDate && syncStats.maxDate
                            ? `${new Date(syncStats.minDate).toLocaleDateString('pt-BR')} - ${new Date(syncStats.maxDate).toLocaleDateString('pt-BR')}`
                            : 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Receitas</p>
                        <p className="font-medium text-green-600 dark:text-green-400">
                          {syncStats.totalIncome.toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL'
                          })}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Despesas</p>
                        <p className="font-medium text-red-600 dark:text-red-400">
                          {syncStats.totalExpense.toLocaleString('pt-BR', {
                            style: 'currency',
                            currency: 'BRL'
                          })}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Progress UI */}
              {(syncStatus !== 'idle' || hasPendingSync) && syncProgress && (
                <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                  <CardContent className="pt-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                        {syncStatus === 'completed' ? (
                          <span className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4" />
                            Sincronização completa!
                          </span>
                        ) : syncStatus === 'waiting' ? (
                          `Aguardando ${waitCountdown}s para continuar...`
                        ) : syncStatus === 'syncing' ? (
                          'Sincronizando categorias...'
                        ) : hasPendingSync ? (
                          'Sincronização pendente'
                        ) : null}
                      </span>
                      <span className="text-sm text-blue-600 dark:text-blue-400">
                        {syncProgress.percentage}%
                      </span>
                    </div>
                    
                    <Progress value={syncProgress.percentage} className="h-3" />
                    
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Progresso</p>
                        <p className="font-medium">
                          {syncProgress.processed.toLocaleString()} / {syncProgress.total.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Categorias obtidas</p>
                        <p className="font-medium text-green-600 dark:text-green-400">
                          {syncProgress.successCount.toLocaleString()} ({Math.round((syncProgress.successCount / syncProgress.processed) * 100) || 0}%)
                        </p>
                      </div>
                    </div>

                    {(syncStatus === 'syncing' || syncStatus === 'waiting') && (
                      <Button 
                        onClick={handleCancelSync} 
                        variant="outline" 
                        className="w-full"
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Pausar Sincronização
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-2 gap-4">
                {hasPendingSync ? (
                  <Button 
                    onClick={() => handleAutoSync(true)} 
                    disabled={isBusy}
                    size="lg" 
                    className="w-full col-span-2"
                  >
                    <RefreshCw className="mr-2 h-5 w-5" />
                    Continuar Sincronização ({syncProgress?.percentage}%)
                  </Button>
                ) : (
                  <Button 
                    onClick={() => handleAutoSync(false)} 
                    disabled={isBusy}
                    size="lg" 
                    className="w-full"
                  >
                    {syncing && syncStatus !== 'waiting' ? (
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
                )}

                {!hasPendingSync && (
                  <Button 
                    onClick={handleClearAndResync} 
                    disabled={isBusy}
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
                )}
              </div>
              
              {!hasPendingSync && (
                <p className="text-xs text-muted-foreground text-center">
                  A sincronização automática continua até completar todas as categorias
                </p>
              )}

              <Button 
                onClick={handleTestCategories} 
                disabled={isBusy || testingCategories}
                variant="secondary"
                size="lg" 
                className="w-full"
              >
                {testingCategories ? (
                  <>
                    <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                    Testando Categorias...
                  </>
                ) : (
                  <>
                    <Tags className="mr-2 h-5 w-5" />
                    Testar Categorias (API Nova)
                  </>
                )}
              </Button>

              {categoryTestResults && categoryTestResults.summary && (
                <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Tags className="h-4 w-4" />
                      Resultados do Teste de Categorias
                    </CardTitle>
                    <CardDescription>
                      Taxa de sucesso: {categoryTestResults.summary.successRate || 'N/A'} | 
                      {categoryTestResults.summary.categoriesFound || 0} categorias encontradas
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-64">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left p-2 font-medium">Descrição</th>
                            <th className="text-left p-2 font-medium">Tipo</th>
                            <th className="text-left p-2 font-medium">Cat. Atual</th>
                            <th className="text-left p-2 font-medium">Nova Categoria</th>
                          </tr>
                        </thead>
                        <tbody>
                          {categoryTestResults.results.map((item) => (
                            <tr key={item.id} className="border-b border-border/50">
                              <td className="p-2 truncate max-w-[200px]" title={item.descricao}>
                                {item.descricao}
                              </td>
                              <td className="p-2">
                                <span className={item.tipo === 'Receita' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                  {item.tipo}
                                </span>
                              </td>
                              <td className="p-2 text-muted-foreground">{item.categoria_atual}</td>
                              <td className="p-2 font-medium text-blue-600 dark:text-blue-400">
                                {item.nome_categoria_principal}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
};