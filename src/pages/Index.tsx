import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DashboardStats } from "@/components/DashboardStats";
import { TransactionList } from "@/components/TransactionList";
import { AddTransactionDialog } from "@/components/AddTransactionDialog";
import { Button } from "@/components/ui/button";
import { LogOut, User } from "lucide-react";
import { toast } from "sonner";
import { startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";

const Index = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
    previousBalance: 0,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        loadData(session.user.id);
      } else {
        navigate("/auth");
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        setUser(session.user);
        loadData(session.user.id);
      } else {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const loadData = async (userId: string) => {
    await Promise.all([loadTransactions(userId), loadCategories(userId), seedDefaultCategories(userId)]);
  };

  const seedDefaultCategories = async (userId: string) => {
    const { data: existingCategories } = await supabase
      .from("categories")
      .select("*")
      .eq("user_id", userId);

    if (existingCategories && existingCategories.length === 0) {
      const defaultCategories = [
        { name: "Salário", type: "income", color: "#10b981", user_id: userId },
        { name: "Freelance", type: "income", color: "#22c55e", user_id: userId },
        { name: "Investimentos", type: "income", color: "#84cc16", user_id: userId },
        { name: "Alimentação", type: "expense", color: "#ef4444", user_id: userId },
        { name: "Transporte", type: "expense", color: "#f97316", user_id: userId },
        { name: "Moradia", type: "expense", color: "#dc2626", user_id: userId },
        { name: "Lazer", type: "expense", color: "#f43f5e", user_id: userId },
      ];

      await supabase.from("categories").insert(defaultCategories);
    }
  };

  const loadCategories = async (userId: string) => {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      toast.error("Erro ao carregar categorias");
      return;
    }

    setCategories(data || []);
  };

  const loadTransactions = async (userId: string) => {
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const previousMonthStart = startOfMonth(subMonths(now, 1));
    const previousMonthEnd = endOfMonth(subMonths(now, 1));

    const { data: currentData, error: currentError } = await supabase
      .from("transactions")
      .select("*, categories(*)")
      .eq("user_id", userId)
      .gte("date", currentMonthStart.toISOString().split("T")[0])
      .lte("date", currentMonthEnd.toISOString().split("T")[0]);

    if (currentError) {
      toast.error("Erro ao carregar transações");
      return;
    }

    const { data: previousData } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", userId)
      .gte("date", previousMonthStart.toISOString().split("T")[0])
      .lte("date", previousMonthEnd.toISOString().split("T")[0]);

    setTransactions(currentData || []);

    const currentIncome = currentData
      ?.filter((t) => t.type === "income")
      .reduce((sum, t) => sum + Number(t.amount), 0) || 0;

    const currentExpense = currentData
      ?.filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + Number(t.amount), 0) || 0;

    const previousIncome = previousData
      ?.filter((t) => t.type === "income")
      .reduce((sum, t) => sum + Number(t.amount), 0) || 0;

    const previousExpense = previousData
      ?.filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + Number(t.amount), 0) || 0;

    setStats({
      totalIncome: currentIncome,
      totalExpense: currentExpense,
      balance: currentIncome - currentExpense,
      previousBalance: previousIncome - previousExpense,
    });
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
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            FinanceFlow
          </h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4" />
              <span className="hidden md:inline">{user?.email}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold">Dashboard</h2>
            <p className="text-muted-foreground">
              {format(new Date(), "MMMM 'de' yyyy", { locale: ptBR })}
            </p>
          </div>
          <AddTransactionDialog
            categories={categories}
            onSuccess={() => user && loadData(user.id)}
          />
        </div>

        <div className="space-y-6">
          <DashboardStats
            totalIncome={stats.totalIncome}
            totalExpense={stats.totalExpense}
            balance={stats.balance}
            previousBalance={stats.previousBalance}
          />

          <TransactionList transactions={transactions} />
        </div>
      </main>
    </div>
  );
};

export default Index;
