import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { LogOut, Calendar, RefreshCw } from "lucide-react";
import { DashboardStats } from "@/components/DashboardStats";
import { TransactionList } from "@/components/TransactionList";
import { ContaAzulAuth } from "@/components/ContaAzulAuth";
import { toast } from "sonner";

const Index = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
    previousBalance: 0,
  });
  const [hasContaAzulToken, setHasContaAzulToken] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        checkContaAzulToken();
        loadContaAzulData();
      } else {
        navigate("/auth");
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        checkContaAzulToken();
        loadContaAzulData();
      } else {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const checkContaAzulToken = () => {
    const token = localStorage.getItem("conta_azul_access_token");
    setHasContaAzulToken(!!token);
  };

  const loadContaAzulData = async () => {
    const token = localStorage.getItem("conta_azul_access_token");
    if (!token) return;

    try {
      setRefreshing(true);
      
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

      const formatDate = (date: Date) => date.toISOString().split('T')[0];

      // Fetch current month data
      const { data: currentData, error: currentError } = await supabase.functions.invoke("conta-azul-data", {
        body: {
          accessToken: token,
          startDate: formatDate(currentMonthStart),
          endDate: formatDate(currentMonthEnd),
        },
      });

      if (currentError) throw currentError;

      // Fetch previous month data
      const { data: previousData, error: previousError } = await supabase.functions.invoke("conta-azul-data", {
        body: {
          accessToken: token,
          startDate: formatDate(previousMonthStart),
          endDate: formatDate(previousMonthEnd),
        },
      });

      if (previousError) throw previousError;

      // Process current month transactions
      const currentTransactions = [
        ...(currentData.contasAReceber || []).map((item: any) => ({
          id: item.id,
          type: 'income',
          amount: item.valor || 0,
          description: item.descricao || 'Conta a Receber',
          date: item.data_competencia || item.data_vencimento,
          category: {
            name: item.categoria?.descricao || 'Receita',
            color: '#22c55e',
          },
        })),
        ...(currentData.contasAPagar || []).map((item: any) => ({
          id: item.id,
          type: 'expense',
          amount: item.valor || 0,
          description: item.descricao || 'Conta a Pagar',
          date: item.data_competencia || item.data_vencimento,
          category: {
            name: item.categoria?.descricao || 'Despesa',
            color: '#ef4444',
          },
        })),
      ];

      // Calculate current month stats
      const currentIncome = currentTransactions
        .filter((t) => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
      
      const currentExpense = currentTransactions
        .filter((t) => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);

      // Calculate previous month balance
      const previousIncome = (previousData.contasAReceber || [])
        .reduce((sum: number, item: any) => sum + (item.valor || 0), 0);
      
      const previousExpense = (previousData.contasAPagar || [])
        .reduce((sum: number, item: any) => sum + (item.valor || 0), 0);

      const previousBalance = previousIncome - previousExpense;
      const currentBalance = currentIncome - currentExpense;

      setTransactions(currentTransactions);
      setStats({
        totalIncome: currentIncome,
        totalExpense: currentExpense,
        balance: currentBalance,
        previousBalance,
      });

      toast.success("Dados atualizados com sucesso!");
    } catch (error: any) {
      console.error("Error loading Conta Azul data:", error);
      toast.error("Erro ao carregar dados do Conta Azul");
      
      // If token is invalid, clear it
      if (error.message?.includes("401") || error.message?.includes("token")) {
        localStorage.removeItem("conta_azul_access_token");
        localStorage.removeItem("conta_azul_refresh_token");
        localStorage.removeItem("conta_azul_token_expires_at");
        setHasContaAzulToken(false);
      }
    } finally {
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    loadContaAzulData();
  };

  const handleDisconnect = () => {
    localStorage.removeItem("conta_azul_access_token");
    localStorage.removeItem("conta_azul_refresh_token");
    localStorage.removeItem("conta_azul_token_expires_at");
    setHasContaAzulToken(false);
    setTransactions([]);
    setStats({
      totalIncome: 0,
      totalExpense: 0,
      balance: 0,
      previousBalance: 0,
    });
    toast.success("Desconectado do Conta Azul");
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Logout realizado com sucesso");
    navigate("/auth");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
            FinanceFlow
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            {hasContaAzulToken && (
              <Button onClick={handleDisconnect} variant="outline" size="sm">
                Desconectar Conta Azul
              </Button>
            )}
            <Button onClick={handleSignOut} variant="outline" size="sm">
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        {!hasContaAzulToken ? (
          <ContaAzulAuth />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold">Dashboard Financeiro</h2>
                <div className="flex items-center gap-2 mt-2 text-muted-foreground">
                  <Calendar className="h-4 w-4" />
                  <span>{new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span>
                </div>
              </div>
              <Button onClick={handleRefresh} disabled={refreshing} variant="outline">
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Atualizar Dados
              </Button>
            </div>

            <DashboardStats
              totalIncome={stats.totalIncome}
              totalExpense={stats.totalExpense}
              balance={stats.balance}
              previousBalance={stats.previousBalance}
            />

            <TransactionList transactions={transactions} />
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
