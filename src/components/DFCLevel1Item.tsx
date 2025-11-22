import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DFCLevel2Item } from "./DFCLevel2Item";
import { extractOrderNumber } from "@/lib/dfcUtils";

interface Level2Group {
  total: number;
  transactions: any[];
}

interface DFCLevel1ItemProps {
  nivel1: string;
  total: number;
  level2Data: Record<string, Level2Group>;
}

export const DFCLevel1Item = ({ nivel1, total, level2Data }: DFCLevel1ItemProps) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isOpen ? (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          )}
          <span className="font-semibold text-lg">{nivel1}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {Object.keys(level2Data).length} categorias
          </span>
          <span className={`font-bold text-lg ${total >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {total.toLocaleString('pt-BR', {
              style: 'currency',
              currency: 'BRL'
            })}
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-2">
          {Object.entries(level2Data)
            .sort(([a], [b]) => {
              const numA = extractOrderNumber(a);
              const numB = extractOrderNumber(b);
              return numA - numB;
            })
            .map(([nivel2, data]) => (
              <DFCLevel2Item
                key={nivel2}
                nivel2={nivel2}
                total={data.total}
                transactions={data.transactions}
              />
            ))}
        </div>
      )}
    </Card>
  );
};