import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";

interface Transaction {
  id: string;
  description: string;
  amount: number;
  transaction_date: string;
  type: string;
  status: string;
  entity_name: string | null;
}

interface DFCLevel2ItemProps {
  nivel2: string;
  total: number;
  transactions: Transaction[];
}

export const DFCLevel2Item = ({ nivel2, total, transactions }: DFCLevel2ItemProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="bg-muted/30 border-muted">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="font-medium">{nivel2}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {transactions.length} lançamentos
          </span>
          <span className={`font-semibold ${total >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {total.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL'
            })}
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="px-3 pb-3 space-y-1">
          {transactions.map((trans) => (
            <div
              key={trans.id}
              className="flex items-center justify-between p-2 rounded hover:bg-background/50 text-sm"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {trans.type === 'income' ? (
                  <TrendingUp className="h-4 w-4 text-green-500 flex-shrink-0" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-500 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{trans.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(trans.transaction_date).toLocaleDateString('pt-BR')}
                    {trans.entity_name && ` • ${trans.entity_name}`}
                  </p>
                </div>
              </div>
              <div className="text-right ml-4">
                <p className={`font-semibold ${trans.amount >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {Number(trans.amount).toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL'
                  })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {trans.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};