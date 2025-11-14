import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";

interface PendingStatsProps {
  pendingReceivables: number;
  receivablesCount: number;
  pendingPayables: number;
  payablesCount: number;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

export const PendingStats = ({
  pendingReceivables,
  receivablesCount,
  pendingPayables,
  payablesCount,
}: PendingStatsProps) => {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Contas a Receber Pendentes
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">
            {formatCurrency(pendingReceivables)}
          </div>
          <div className="flex justify-end mt-2">
            <p className="text-xs text-muted-foreground">
              Qtde: <span className="font-semibold">{receivablesCount}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Contas a Pagar Pendentes
          </CardTitle>
          <TrendingDown className="h-4 w-4 text-red-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">
            {formatCurrency(pendingPayables)}
          </div>
          <div className="flex justify-end mt-2">
            <p className="text-xs text-muted-foreground">
              Qtde: <span className="font-semibold">{payablesCount}</span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
