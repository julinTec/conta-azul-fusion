import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface DashboardStatsProps {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  previousBalance: number;
}

export const DashboardStats = ({
  totalIncome,
  totalExpense,
  balance,
  previousBalance,
}: DashboardStatsProps) => {
  const balanceChange = balance - previousBalance;
  const balanceChangePercent = previousBalance !== 0 
    ? ((balanceChange / Math.abs(previousBalance)) * 100).toFixed(1)
    : 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="shadow-md hover:shadow-lg transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Receitas</CardTitle>
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center">
            <TrendingUp className="h-4 w-4 text-white" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{formatCurrency(totalIncome)}</div>
          <p className="text-xs text-muted-foreground mt-1">Este mês</p>
        </CardContent>
      </Card>

      <Card className="shadow-md hover:shadow-lg transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Despesas</CardTitle>
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center">
            <TrendingDown className="h-4 w-4 text-white" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">{formatCurrency(totalExpense)}</div>
          <p className="text-xs text-muted-foreground mt-1">Este mês</p>
        </CardContent>
      </Card>

      <Card className="shadow-md hover:shadow-lg transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Saldo</CardTitle>
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <DollarSign className="h-4 w-4 text-white" />
          </div>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${balance >= 0 ? 'text-primary' : 'text-red-600'}`}>
            {formatCurrency(balance)}
          </div>
          <div className="flex items-center mt-1 text-xs">
            {balanceChange >= 0 ? (
              <>
                <ArrowUpRight className="h-3 w-3 text-green-600 mr-1" />
                <span className="text-green-600">+{balanceChangePercent}%</span>
              </>
            ) : (
              <>
                <ArrowDownRight className="h-3 w-3 text-red-600 mr-1" />
                <span className="text-red-600">{balanceChangePercent}%</span>
              </>
            )}
            <span className="text-muted-foreground ml-1">vs mês anterior</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
