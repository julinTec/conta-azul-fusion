import { useState, useEffect } from "react";
import { DashboardStats } from "@/components/DashboardStats";
import { AdminPanel } from "@/components/AdminPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Calendar as CalendarIcon, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useSchool } from "@/contexts/SchoolContext";
import { useNavigate } from "react-router-dom";

export const Dashboard = () => {
  const navigate = useNavigate();
  const { school, loading: schoolLoading } = useSchool();
  const getPreviousMonthDates = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    return { firstDay, lastDay };
  };

  const { firstDay, lastDay } = getPreviousMonthDates();
  
  const [stats, setStats] = useState({
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
    previousBalance: 0,
    previousIncome: 0,
    previousExpense: 0,
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState<Date>(firstDay);
  const [endDate, setEndDate] = useState<Date>(lastDay);

  useEffect(() => {
    if (!schoolLoading && !school) {
      navigate('/schools');
    }
  }, [school, schoolLoading, navigate]);

  useEffect(() => {
    if (school?.id) {
      loadDashboardData();
    }
  }, [startDate, endDate, school?.id]);

  const fetchAllTransactions = async (startDateStr: string, endDateStr: string) => {
    if (!school?.id) return [];
    
    const pageSize = 1000;
    let from = 0;
    let to = pageSize - 1;
    const all: any[] = [];

    while (true) {
      const { data: batch, error } = await supabase
        .from('synced_transactions')
        .select('type, amount, transaction_date, status')
        .eq('school_id', school.id)
        .eq('status', 'RECEBIDO')
        .gte('transaction_date', startDateStr)
        .lte('transaction_date', endDateStr)
        .order('transaction_date', { ascending: true })
        .range(from, to);

      if (error) throw error;
      if (!batch || batch.length === 0) break;

      all.push(...batch);
      if (batch.length < pageSize) break;

      from += pageSize;
      to += pageSize;
    }

    return all;
  };

  const fetchAllTransactionsForChart = async () => {
    if (!school?.id) return [];
    
    const pageSize = 1000;
    let from = 0;
    let to = pageSize - 1;
    const all: any[] = [];

    while (true) {
      const { data: batch, error } = await supabase
        .from('synced_transactions')
        .select('type, amount, transaction_date, status')
        .eq('school_id', school.id)
        .eq('status', 'RECEBIDO')
        .order('transaction_date', { ascending: true })
        .range(from, to);

      if (error) throw error;
      if (!batch || batch.length === 0) break;

      all.push(...batch);
      if (batch.length < pageSize) break;

      from += pageSize;
      to += pageSize;
    }

    return all;
  };

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      
      const now = new Date();
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      // Buscar todas as transações do período selecionado com paginação
      const transactions = await fetchAllTransactions(startDateStr, endDateStr);

      // Debug logs
      console.log('Dashboard data fetch (paginated):', {
        startDateStr,
        totalTransactions: transactions?.length,
        firstDates: transactions?.slice(0, 3).map(t => t.transaction_date),
        lastDates: transactions?.slice(-3).map(t => t.transaction_date)
      });

      if (!transactions || transactions.length === 0) {
        toast.info("Nenhum dado disponível. Aguarde a sincronização.");
        setLoading(false);
        return;
      }

      // Calcular totais gerais
      const totalIncome = transactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);
      
      const totalExpense = transactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);

      const balance = totalIncome - totalExpense;

      // Calcular número de meses no período selecionado
      const monthsInPeriod = (endDate.getFullYear() - startDate.getFullYear()) * 12 
                           + (endDate.getMonth() - startDate.getMonth()) + 1;

      console.log('Período selecionado:', {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        monthsInPeriod
      });

      // Calcular período de comparação (mesmo número de meses ANTES do período selecionado)
      const previousPeriodEnd = new Date(startDate.getFullYear(), startDate.getMonth(), 0);
      const previousPeriodStart = new Date(
        previousPeriodEnd.getFullYear(),
        previousPeriodEnd.getMonth() - monthsInPeriod + 1,
        1
      );

      console.log('Período de comparação:', {
        previousPeriodStart: previousPeriodStart.toISOString().split('T')[0],
        previousPeriodEnd: previousPeriodEnd.toISOString().split('T')[0],
        months: monthsInPeriod
      });

      // Buscar transações do período de comparação
      const previousPeriodTransactions = await fetchAllTransactions(
        previousPeriodStart.toISOString().split('T')[0],
        previousPeriodEnd.toISOString().split('T')[0]
      );

      const previousIncome = previousPeriodTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);
      
      const previousExpense = previousPeriodTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);

      const previousBalance = previousIncome - previousExpense;

      setStats({
        totalIncome,
        totalExpense,
        balance,
        previousBalance,
        previousIncome,
        previousExpense,
      });

      // Buscar TODAS as transações para o gráfico (sem filtro de data)
      const allTransactionsForChart = await fetchAllTransactionsForChart();

      if (allTransactionsForChart.length > 0) {
        // Encontrar primeira e última data no histórico completo
        const firstTransaction = allTransactionsForChart[0];
        const lastTransaction = allTransactionsForChart[allTransactionsForChart.length - 1];
        
        const [firstYear, firstMonth] = firstTransaction.transaction_date.split('-');
        const [lastYear, lastMonth] = lastTransaction.transaction_date.split('-');
        
        const chartStartDate = new Date(Number(firstYear), Number(firstMonth) - 1, 1);
        const chartEndDate = new Date(Number(lastYear), Number(lastMonth) - 1, 1);
        
        // Construir dados do gráfico com TODO o período
        const months = [];
        let cursor = new Date(chartStartDate.getFullYear(), chartStartDate.getMonth(), 1);

        while (cursor <= chartEndDate) {
          const monthTransactions = allTransactionsForChart.filter(t => {
            const [year, month] = t.transaction_date.split('-');
            const transactionYear = Number(year);
            const transactionMonth = Number(month);
            
            return transactionYear === cursor.getFullYear() && 
                   transactionMonth === (cursor.getMonth() + 1);
          });

          const income = monthTransactions
            .filter(t => t.type === 'income')
            .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);
          
          const expense = monthTransactions
            .filter(t => t.type === 'expense')
            .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);

          months.push({
            month: cursor.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
            receitas: income,
            despesas: expense,
          });

          cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        }

        setChartData(months);
      }
    } catch (error: any) {
      console.error("Error loading dashboard data:", error);
      toast.error("Erro ao carregar dados do dashboard");
    } finally {
      setLoading(false);
    }
  };

  if (loading || schoolLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!school) {
    return null;
  }

  return (
    <div className="space-y-8">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-primary">{school.name}</h1>
      </div>
      
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">
            Dashboard Financeiro - {format(startDate, "MMMM 'de' yyyy", { locale: ptBR })}
          </h2>
          <div className="flex items-center gap-2 mt-2 text-muted-foreground">
            <CalendarIcon className="h-4 w-4" />
            <span>
              {format(startDate, "dd/MM/yyyy")} - {format(endDate, "dd/MM/yyyy")}
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground italic">
          *Contém os valores de Aportes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Período</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">De</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, "dd/MM/yyyy") : <span>Selecione a data</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={startDate}
                    onSelect={(date) => date && setStartDate(date)}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            
            <div className="flex-1">
              <label className="text-sm font-medium mb-2 block">Até</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !endDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, "dd/MM/yyyy") : <span>Selecione a data</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={endDate}
                    onSelect={(date) => date && setEndDate(date)}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      <AdminPanel />

      <DashboardStats
        totalIncome={stats.totalIncome}
        totalExpense={stats.totalExpense}
        balance={stats.balance}
        previousBalance={stats.previousBalance}
        previousIncome={stats.previousIncome}
        previousExpense={stats.previousExpense}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Evolução Financeira
          </CardTitle>
          <CardDescription>
            Acompanhe o histórico de receitas e despesas dos últimos meses
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip 
                formatter={(value: number) => 
                  new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL',
                  }).format(value)
                }
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="receitas" 
                stroke="#22c55e" 
                strokeWidth={2}
                name="Receitas"
              />
              <Line 
                type="monotone" 
                dataKey="despesas" 
                stroke="#ef4444" 
                strokeWidth={2}
                name="Despesas"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};
