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
}

type SyncStatus = 'idle' | 'syncing' | 'paused' | 'completed' | 'error';

export const SyncMonitor = () => {
  const { school } = useSchool();
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [progress, setProgress] = useState<SyncProgress>({ processed: 0, total: 0, percentage: 0, successCount: 0 });
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

  // Check for existing checkpoint on mount
  useEffect(() => {
    if (school?.id) {
      checkExistingCheckpoint();
    }
  }, [school?.id]);

  const addLog = (type: LogEntry['type'], message: string) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [...prev, { timestamp, type, message }]);
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
      addLog('info', `Checkpoint encontrado: ${checkpoint.last_processed_index}/${checkpoint.total_transactions} transações processadas`);
      addLog('warn', 'Sincronização interrompida anteriormente. Clique em "Continuar" para retomar.');
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
      addLog('info', '▶ Retomando sincronização...');
    }

    let retryCount = 0;
    const maxRetries = 50; // Limite de tentativas para evitar loop infinito

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
              
              addLog('success', `✓ Checkpoint encontrado: ${checkpoint.last_processed_index}/${checkpoint.total_transactions} (${pct}%)`);
              
              // Verificar se já completou
              if (checkpoint.last_processed_index >= checkpoint.total_transactions) {
                addLog('success', '🎉 Sincronização completa!');
                setStatus('completed');
                return;
              }

              addLog('info', '⏳ Continuando em 5 segundos...');
              await sleep(5000);
              
              retryCount++;
              continue; // Continuar o loop
            } else {
              addLog('warn', 'Nenhum checkpoint encontrado. Iniciando nova sincronização...');
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
            addLog('success', `✓ Progresso: ${respProgress.processed}/${respProgress.total} (${respProgress.percentage}%)`);
          }

          if (completed) {
            addLog('success', `🎉 ${message || 'Sincronização completa!'}`);
            setStatus('completed');
            toast.success("Sincronização concluída!");
            
            // Limpar checkpoint
            await supabase
              .from('sync_checkpoints')
              .delete()
              .eq('school_id', school.id);
            
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
        
        // Se for erro de rede/timeout, tratar graciosamente
        if (errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('timeout')) {
          addLog('warn', `⚠ Erro de conexão: ${errorMsg}`);
          addLog('info', 'Tentando novamente em 10 segundos...');
          await sleep(10000);
          retryCount++;
          continue;
        }
        
        // Erro real
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

  const categorySuccessRate = progress.total > 0 
    ? Math.round((progress.successCount / progress.processed) * 100) || 0
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

        {/* Progress Bar */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progresso</span>
                <span className="font-medium">{progress.percentage}%</span>
              </div>
              <Progress value={progress.percentage} className="h-4" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.processed.toLocaleString()} processadas</span>
                <span>{progress.total.toLocaleString()} total</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Processadas</span>
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
                <span className="text-sm text-muted-foreground">Categorias</span>
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
            <Button onClick={() => handleSync(false)} className="gap-2">
              <Play className="h-4 w-4" />
              Iniciar Sincronização
            </Button>
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
            <Button onClick={() => handleSync(false)} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Sincronizar Novamente
            </Button>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default SyncMonitor;
