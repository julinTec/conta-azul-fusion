import { useState, useEffect } from "react";
import { DashboardStats } from "@/components/DashboardStats";
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

  const loadDashboardData = async () => {
    const token = localStorage.getItem("conta_azul_access_token");
    if (!token) return;

    try {
      setLoading(true);
      
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const formatDate = (date: Date) => date.toISOString().split('T')[0];

      const { data: currentData, error: currentError } = await supabase.functions.invoke("conta-azul-data", {
        body: {
          accessToken: token,
          startDate: formatDate(currentMonthStart),
          endDate: formatDate(currentMonthEnd),
        },
      });

      if (currentError) throw currentError;

      const { data: previousData, error: previousError } = await supabase.functions.invoke("conta-azul-data", {
        body: {
          accessToken: token,
          startDate: formatDate(previousMonthStart),
          endDate: formatDate(previousMonthEnd),
        },
      });

      if (previousError) throw previousError;

      const currentIncome = (currentData.contasAReceber || [])
        .reduce((sum: number, item: any) => sum + (item.total ?? item.pago ?? item.nao_pago ?? 0), 0);
      
      const currentExpense = (currentData.contasAPagar || [])
        .reduce((sum: number, item: any) => sum + (item.total ?? item.pago ?? item.nao_pago ?? 0), 0);

      const previousIncome = (previousData.contasAReceber || [])
        .reduce((sum: number, item: any) => sum + (item.total ?? item.pago ?? item.nao_pago ?? 0), 0);
      
      const previousExpense = (previousData.contasAPagar || [])
        .reduce((sum: number, item: any) => sum + (item.total ?? item.pago ?? item.nao_pago ?? 0), 0);

      const previousBalance = previousIncome - previousExpense;
      const currentBalance = currentIncome - currentExpense;

      setStats({
        totalIncome: currentIncome,
        totalExpense: currentExpense,
        balance: currentBalance,
        previousBalance,
      });

      const months = [];
      for (let i = 5; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
          month: date.toLocaleDateString('pt-BR', { month: 'short' }),
          receitas: 0,
          despesas: 0,
        });
      }

      months[months.length - 2].receitas = previousIncome;
      months[months.length - 2].despesas = previousExpense;
      months[months.length - 1].receitas = currentIncome;
      months[months.length - 1].despesas = currentExpense;

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
