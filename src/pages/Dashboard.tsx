import { useState, useEffect } from "react";
import { DashboardStats } from "@/components/DashboardStats";
import { AdminPanel } from "@/components/AdminPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Calendar, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Dashboard = () => {
  const [stats, setStats] = useState({
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
    previousBalance: 0,
  });
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const fetchAllTransactions = async (startDateStr: string) => {
    const pageSize = 1000;
    let from = 0;
    let to = pageSize - 1;
    const all: any[] = [];

    while (true) {
      const { data: batch, error } = await supabase
        .from('synced_transactions')
        .select('type, amount, transaction_date, status')
        .eq('status', 'RECEBIDO')
        .gte('transaction_date', startDateStr)
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
      const startDate = new Date(2025, 3, 1); // 1º de abril de 2025
      const startDateStr = startDate.toISOString().split('T')[0];
      
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      // Buscar todas as transações desde abril/2025 com paginação
      const transactions = await fetchAllTransactions(startDateStr);

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

      // Calcular mês anterior para comparação
      const previousTransactions = transactions.filter(t => {
        const [year, month] = t.transaction_date.split('-').map(Number);
        return year === previousMonthStart.getFullYear() && 
               month === (previousMonthStart.getMonth() + 1);
      });

      const previousIncome = previousTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);
      
      const previousExpense = previousTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);

      const previousBalance = previousIncome - previousExpense;

      setStats({
        totalIncome,
        totalExpense,
        balance,
        previousBalance,
      });

      // Construir dados do gráfico desde abril/2025
      const months = [];
      let cursor = new Date(2025, 3, 1); // Abril de 2025
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      while (cursor <= lastMonthStart) {
        const monthTransactions = transactions.filter(t => {
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
          month: cursor.toLocaleDateString('pt-BR', { month: 'short' }),
          receitas: income,
          despesas: expense,
        });

        // Avançar para o próximo mês
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }

      setChartData(months);
    } catch (error: any) {
      console.error("Error loading dashboard data:", error);
      toast.error("Erro ao carregar dados do dashboard");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Dashboard Financeiro</h2>
          <div className="flex items-center gap-2 mt-2 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>{new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
          </div>
        </div>
      </div>

      <AdminPanel />

      <DashboardStats
        totalIncome={stats.totalIncome}
        totalExpense={stats.totalExpense}
        balance={stats.balance}
        previousBalance={stats.previousBalance}
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
