import { useState, useEffect, useRef } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { 
  Play, 
  Pause, 
  Trash2, 
  RefreshCw, 
  CheckCircle, 
  XCircle, 
  AlertTriangle,
  Clock,
  Zap,
  Database,
  Tag
} from "lucide-react";
import { toast } from "sonner";

interface LogEntry {
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

interface SyncProgress {
  processed: number;
  total: number;
  percentage: number;
  successCount: number;
  totalInDb?: number;
  alreadyEnriched?: number;
  pendingCount?: number;
}

type SyncStatus = 'idle' | 'syncing' | 'paused' | 'completed' | 'error';

export const SyncMonitor = () => {
  const { school } = useSchool();
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [progress, setProgress] = useState<SyncProgress>({ processed: 0, total: 0, percentage: 0, successCount: 0 });
  const [dbStats, setDbStats] = useState<{ total: number; enriched: number; pending: number }>({ total: 0, enriched: 0, pending: 0 });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const syncAbortRef = useRef(false);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Check for existing checkpoint and DB stats on mount
  useEffect(() => {
    if (school?.id) {
      checkDbStats();
      checkExistingCheckpoint();
    }
  }, [school?.id]);

  const addLog = (type: LogEntry['type'], message: string) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev, { timestamp, type, message }]);
  };

  const checkDbStats = async () => {
    if (!school?.id) return;

    // Total transactions
    const { count: total } = await supabase
      .from('synced_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', school.id);

    // Pending (with fallback category)
    const { count: pending } = await supabase
      .from('synced_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', school.id)
      .in('category_name', ['Outras Receitas', 'Outras Despesas']);

    const enriched = (total || 0) - (pending || 0);
    
    setDbStats({
      total: total || 0,
      enriched,
      pending: pending || 0
    });

    if (total && total > 0) {
      addLog('info', `📊 Estatísticas do banco: ${total} total | ${enriched} com categoria | ${pending} pendentes`);
    }
  };

  const checkExistingCheckpoint = async () => {
    if (!school?.id) return;

    const { data: checkpoint } = await supabase
      .from('sync_checkpoints')
      .select('*')
      .eq('school_id', school.id)
      .maybeSingle();

    if (checkpoint) {
      setProgress({
        processed: checkpoint.last_processed_index || 0,
        total: checkpoint.total_transactions || 0,
        percentage: checkpoint.total_transactions 
          ? Math.round((checkpoint.last_processed_index || 0) / checkpoint.total_transactions * 100) 
          : 0,
        successCount: checkpoint.success_count || 0
      });
      setStatus('paused');
      addLog('info', `Checkpoint encontrado: ${checkpoint.last_processed_index}/${checkpoint.total_transactions} transações do lote atual`);
      addLog('warn', 'Sincronização interrompida anteriormente. Clique em "Continuar" para retomar.');
    } else if (dbStats.pending > 0) {
      addLog('warn', `⚠️ ${dbStats.pending} transações sem categoria real. Clique em "Enriquecer" para processar.`);
    }
  };

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const handleSync = async (resumeOnly = false) => {
    if (!school?.id) {
      toast.error("Escola não selecionada");
      return;
    }

    syncAbortRef.current = false;
    setIsPaused(false);
    setStatus('syncing');
    
    if (!resumeOnly) {
      setStartTime(new Date());
      addLog('info', `▶ Iniciando sincronização para escola: ${school.name}`);
    } else {
      addLog('info', '▶ Retomando enriquecimento de categorias...');
    }

    let retryCount = 0;
    const maxRetries = 100; // Aumentado para suportar mais transações

    while (retryCount < maxRetries && !syncAbortRef.current) {
      try {
        addLog('info', 'Conectando à API do Conta Azul...');
        
        const { data, error } = await supabase.functions.invoke('sync-conta-azul', {
          body: { 
            school_id: school.id,
            resume_only: resumeOnly || retryCount > 0
          }
        });

        if (error) {
          // Verifica se é erro de timeout (FunctionsFetchError ou edge function timeout)
          if (error.message?.includes('FunctionsFetch') || 
              error.message?.includes('Failed to fetch') ||
              error.message?.includes('timeout')) {
            addLog('warn', '⏳ Conexão perdida (timeout). Verificando checkpoint...');
            
            // Aguardar um pouco antes de verificar o checkpoint
            await sleep(2000);
            
            // Atualizar stats do banco
            await checkDbStats();
            
            // Buscar checkpoint real do banco
            const { data: checkpoint } = await supabase
              .from('sync_checkpoints')
              .select('*')
              .eq('school_id', school.id)
              .maybeSingle();

            if (checkpoint) {
              const pct = Math.round((checkpoint.last_processed_index || 0) / (checkpoint.total_transactions || 1) * 100);
              setProgress({
                processed: checkpoint.last_processed_index || 0,
                total: checkpoint.total_transactions || 0,
                percentage: pct,
                successCount: checkpoint.success_count || 0
              });
              
              addLog('success', `✓ Checkpoint: ${checkpoint.last_processed_index}/${checkpoint.total_transactions} do lote atual (${pct}%)`);
              
              // Verificar se o lote atual completou
              if (checkpoint.last_processed_index >= checkpoint.total_transactions) {
                // Verificar se ainda há pendentes no banco
                const { count: stillPending } = await supabase
                  .from('synced_transactions')
                  .select('*', { count: 'exact', head: true })
                  .eq('school_id', school.id)
                  .in('category_name', ['Outras Receitas', 'Outras Despesas']);
                
                if (stillPending && stillPending > 0) {
                  addLog('info', `📦 Lote completo. Ainda há ${stillPending} transações pendentes.`);
                } else {
                  addLog('success', '🎉 Sincronização 100% completa! Todas as transações têm categorias.');
                  setStatus('completed');
                  await checkDbStats();
                  return;
                }
              }

              addLog('info', '⏳ Continuando em 5 segundos...');
              await sleep(5000);
              
              retryCount++;
              continue; // Continuar o loop
            } else {
              // Sem checkpoint, verificar se há pendentes
              const { count: pending } = await supabase
                .from('synced_transactions')
                .select('*', { count: 'exact', head: true })
                .eq('school_id', school.id)
                .in('category_name', ['Outras Receitas', 'Outras Despesas']);
              
              if (!pending || pending === 0) {
                addLog('success', '🎉 Sincronização completa! Todas as transações têm categorias.');
                setStatus('completed');
                await checkDbStats();
                return;
              }
              
              addLog('info', `📦 ${pending} transações pendentes encontradas. Continuando...`);
              await sleep(3000);
              retryCount++;
              continue;
            }
          }
          
          throw error;
        }

        // Resposta bem-sucedida
        if (data) {
          const { completed, progress: respProgress, message } = data;
          
          if (respProgress) {
            setProgress(respProgress);
            
            const pendingInfo = respProgress.pendingCount !== undefined 
              ? ` | ${respProgress.pendingCount} pendentes restantes` 
              : '';
            
            addLog('success', `✓ Progresso: ${respProgress.processed}/${respProgress.total} (${respProgress.percentage}%)${pendingInfo}`);
          }

          // Atualizar stats
          await checkDbStats();

          if (completed) {
            // Verificar se realmente completou (verificar pendentes no banco)
            const { count: stillPending } = await supabase
              .from('synced_transactions')
              .select('*', { count: 'exact', head: true })
              .eq('school_id', school.id)
              .in('category_name', ['Outras Receitas', 'Outras Despesas']);
            
            if (stillPending && stillPending > 0) {
              addLog('info', `📦 Lote completo. Ainda há ${stillPending} transações pendentes.`);
              await sleep(3000);
              retryCount++;
              continue;
            }
            
            addLog('success', `🎉 ${message || 'Sincronização completa!'}`);
            setStatus('completed');
            toast.success("Sincronização concluída!");
            return;
          } else {
            // Ainda não completou, continuar
            addLog('info', message || 'Processando...');
            await sleep(3000);
            retryCount++;
            continue;
          }
        }

      } catch (err: any) {
        const errorMsg = err?.message || 'Erro desconhecido';
        const errorLower = errorMsg.toLowerCase();
        
        // Detectar erros de rede/timeout de forma abrangente
        const isNetworkError = 
          errorLower.includes('fetch') || 
          errorLower.includes('network') || 
          errorLower.includes('timeout') ||
          errorLower.includes('failed to send') ||
          errorLower.includes('edge function') ||
          errorLower.includes('aborted') ||
          errorLower.includes('connection') ||
          errorLower.includes('504') ||
          errorLower.includes('502') ||
          errorLower.includes('gateway');
        
        if (isNetworkError) {
          addLog('warn', `⚠ Conexão perdida: ${errorMsg}`);
          addLog('info', '🔍 Verificando progresso salvo...');
          
          // Verificar checkpoint para obter progresso real
          try {
            const { data: checkpoint } = await supabase
              .from('sync_checkpoints')
              .select('*')
              .eq('school_id', school.id)
              .maybeSingle();
            
            if (checkpoint) {
              const checkpointProgress = Math.round(
                (checkpoint.last_processed_index / checkpoint.total_transactions) * 100
              );
              addLog('success', `✓ Checkpoint: ${checkpoint.last_processed_index}/${checkpoint.total_transactions} (${checkpointProgress}%)`);
              setProgress({
                processed: checkpoint.last_processed_index,
                total: checkpoint.total_transactions,
                percentage: checkpointProgress,
                successCount: checkpoint.success_count || 0
              });
            }
            
            // Atualizar estatísticas do banco
            await checkDbStats();
            addLog('info', `📊 Stats: ${dbStats.total} total | ${dbStats.enriched} enriquecidas | ${dbStats.pending} pendentes`);
            
          } catch (checkError) {
            addLog('warn', '⚠ Não foi possível verificar checkpoint');
          }
          
          addLog('info', '⏳ Continuando em 10 segundos...');
          await sleep(10000);
          retryCount++;
          continue;
        }
        
        // Erro real não relacionado a rede
        addLog('error', `✖ Erro: ${errorMsg}`);
        setStatus('error');
        toast.error(`Erro na sincronização: ${errorMsg}`);
        return;
      }
    }

    if (syncAbortRef.current) {
      addLog('warn', '⏸ Sincronização pausada pelo usuário');
      setStatus('paused');
    } else if (retryCount >= maxRetries) {
      addLog('error', '✖ Número máximo de tentativas atingido');
      setStatus('error');
    }
  };

  const handlePause = () => {
    syncAbortRef.current = true;
    setIsPaused(true);
    addLog('warn', '⏸ Pausando sincronização...');
  };

  const handleClearLogs = () => {
    setLogs([]);
    toast.success("Logs limpos");
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'idle':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Aguardando</Badge>;
      case 'syncing':
        return <Badge className="bg-blue-500"><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Sincronizando</Badge>;
      case 'paused':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600"><Pause className="h-3 w-3 mr-1" /> Pausado</Badge>;
      case 'completed':
        return <Badge className="bg-green-500"><CheckCircle className="h-3 w-3 mr-1" /> Completo</Badge>;
      case 'error':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Erro</Badge>;
    }
  };

  const getLogIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'info': return <span className="text-blue-400">▶</span>;
      case 'success': return <span className="text-green-400">✓</span>;
      case 'warn': return <span className="text-yellow-400">⚠</span>;
      case 'error': return <span className="text-red-400">✖</span>;
    }
  };

  const getLogClass = (type: LogEntry['type']) => {
    switch (type) {
      case 'info': return 'text-blue-300';
      case 'success': return 'text-green-300';
      case 'warn': return 'text-yellow-300';
      case 'error': return 'text-red-300';
    }
  };

  // Calculate estimated time remaining
  const getEstimatedTime = () => {
    if (!startTime || progress.processed === 0 || progress.total === 0) return '--';
    
    const elapsed = (Date.now() - startTime.getTime()) / 1000;
    const rate = progress.processed / elapsed;
    const remaining = progress.total - progress.processed;
    const estimatedSeconds = remaining / rate;
    
    if (estimatedSeconds < 60) return `${Math.round(estimatedSeconds)}s`;
    if (estimatedSeconds < 3600) return `${Math.round(estimatedSeconds / 60)}min`;
    return `${Math.round(estimatedSeconds / 3600)}h ${Math.round((estimatedSeconds % 3600) / 60)}min`;
  };

  // Calculate speed
  const getSpeed = () => {
    if (!startTime || progress.processed === 0) return '--';
    
    const elapsed = (Date.now() - startTime.getTime()) / 1000;
    const rate = progress.processed / elapsed;
    return `${rate.toFixed(1)}/s`;
  };

  const categorySuccessRate = progress.processed > 0 
    ? Math.round((progress.successCount / progress.processed) * 100) || 0
    : 0;

  const dbEnrichmentRate = dbStats.total > 0 
    ? Math.round((dbStats.enriched / dbStats.total) * 100)
    : 0;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Monitor de Sincronização</h1>
            <p className="text-muted-foreground">{school?.name}</p>
          </div>
          {getStatusBadge()}
        </div>

        {/* DB Stats Cards - Real totals */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-2 border-primary/20">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Total no Banco</span>
              </div>
              <p className="text-3xl font-bold mt-1 text-primary">
                {dbStats.total.toLocaleString()}
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 border-green-500/20">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">Com Categoria Real</span>
              </div>
              <p className="text-3xl font-bold mt-1 text-green-500">
                {dbStats.enriched.toLocaleString()}
                <span className="text-sm font-normal text-muted-foreground ml-2">({dbEnrichmentRate}%)</span>
              </p>
            </CardContent>
          </Card>

          <Card className="border-2 border-yellow-500/20">
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium">Pendentes</span>
              </div>
              <p className="text-3xl font-bold mt-1 text-yellow-500">
                {dbStats.pending.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Progress Bar - Current batch */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progresso do Lote Atual</span>
                <span className="font-medium">{progress.percentage}%</span>
              </div>
              <Progress value={progress.percentage} className="h-4" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.processed.toLocaleString()} processadas neste lote</span>
                <span>{progress.total.toLocaleString()} no lote</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Current batch Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Lote Atual</span>
              </div>
              <p className="text-2xl font-bold mt-1">
                {progress.processed.toLocaleString()}
                <span className="text-sm font-normal text-muted-foreground">/{progress.total.toLocaleString()}</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Categorias (lote)</span>
              </div>
              <p className="text-2xl font-bold mt-1">
                {progress.successCount.toLocaleString()}
                <span className="text-sm font-normal text-muted-foreground"> ({categorySuccessRate}%)</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Tempo Rest.</span>
              </div>
              <p className="text-2xl font-bold mt-1">~{getEstimatedTime()}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Velocidade</span>
              </div>
              <p className="text-2xl font-bold mt-1">{getSpeed()}</p>
            </CardContent>
          </Card>
        </div>

        {/* Log Console */}
        <Card className="bg-slate-950 border-slate-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-slate-200 flex items-center gap-2">
                <span className="text-green-400">$</span> Console de Logs
              </CardTitle>
              <div className="flex items-center gap-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="auto-scroll"
                    checked={autoScroll}
                    onCheckedChange={setAutoScroll}
                  />
                  <Label htmlFor="auto-scroll" className="text-slate-400 text-sm">Auto-scroll</Label>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleClearLogs}
                  className="text-slate-400 hover:text-slate-200"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Limpar
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80 rounded border border-slate-800 bg-slate-900 p-4 font-mono text-sm">
              {logs.length === 0 ? (
                <p className="text-slate-500 italic">Aguardando início da sincronização...</p>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-slate-500">[{log.timestamp}]</span>
                      {getLogIcon(log.type)}
                      <span className={getLogClass(log.type)}>{log.message}</span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Controls */}
        <div className="flex gap-4">
          {status === 'idle' || status === 'error' ? (
            <>
              {dbStats.pending > 0 ? (
                <Button onClick={() => handleSync(true)} className="gap-2 bg-yellow-600 hover:bg-yellow-700">
                  <Tag className="h-4 w-4" />
                  Enriquecer {dbStats.pending.toLocaleString()} Pendentes
                </Button>
              ) : null}
              <Button onClick={() => handleSync(false)} variant={dbStats.pending > 0 ? "outline" : "default"} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Nova Sincronização Completa
              </Button>
            </>
          ) : status === 'syncing' ? (
            <Button onClick={handlePause} variant="outline" className="gap-2">
              <Pause className="h-4 w-4" />
              Pausar
            </Button>
          ) : status === 'paused' ? (
            <Button onClick={() => handleSync(true)} className="gap-2">
              <Play className="h-4 w-4" />
              Continuar Sincronização
            </Button>
          ) : null}
          
          {status === 'completed' && (
            <>
              {dbStats.pending > 0 ? (
                <Button onClick={() => handleSync(true)} className="gap-2 bg-yellow-600 hover:bg-yellow-700">
                  <Tag className="h-4 w-4" />
                  Enriquecer {dbStats.pending.toLocaleString()} Pendentes
                </Button>
              ) : null}
              <Button onClick={() => handleSync(false)} variant="outline" className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Sincronizar Novamente
              </Button>
            </>
          )}
          
          <Button onClick={checkDbStats} variant="ghost" className="gap-2">
            <Database className="h-4 w-4" />
            Atualizar Stats
          </Button>
        </div>
      </div>
    </Layout>
  );
};

export default SyncMonitor;
