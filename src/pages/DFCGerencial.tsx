import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, FileDown } from "lucide-react";
import { toast } from "sonner";
import { startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";
import { DFCLevel1Item } from "@/components/DFCLevel1Item";

interface Transaction {
  id: string;
  description: string;
  amount: number;
  transaction_date: string;
  type: string;
  status: string;
  entity_name: string | null;
  category_name: string | null;
}

interface Level2Group {
  total: number;
  transactions: Transaction[];
}

interface Level1Group {
  total: number;
  level2: Record<string, Level2Group>;
}

export const DFCGerencial = () => {
  const { school } = useSchool();
  const [loading, setLoading] = useState(true);
  const [groupedData, setGroupedData] = useState<Record<string, Level1Group>>({});
  
  const previousMonth = subMonths(new Date(), 1);
  const [startDate, setStartDate] = useState(format(startOfMonth(previousMonth), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(endOfMonth(previousMonth), "yyyy-MM-dd"));

  useEffect(() => {
    if (school?.id) {
      loadData();
    }
  }, [school?.id, startDate, endDate]);

  const loadData = async () => {
    if (!school?.id) return;
    
    setLoading(true);
    try {
      // Buscar transações com status RECEBIDO (efetivadas)
      const { data: transData, error: transError } = await supabase
        .from('synced_transactions')
        .select('*')
        .eq('school_id', school.id)
        .eq('status', 'RECEBIDO')
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .order('transaction_date', { ascending: false });

      if (transError) throw transError;

      // Agrupar por type (Nível 1) e category_name (Nível 2)
      const grouped: Record<string, Level1Group> = {
        'Receitas': { total: 0, level2: {} },
        'Despesas': { total: 0, level2: {} }
      };

      (transData || []).forEach(trans => {
        const nivel1 = trans.type === 'income' ? 'Receitas' : 'Despesas';
        const nivel2 = trans.category_name || (trans.type === 'income' ? 'Outras Receitas' : 'Outras Despesas');

        if (!grouped[nivel1].level2[nivel2]) {
          grouped[nivel1].level2[nivel2] = {
            total: 0,
            transactions: []
          };
        }

        // Despesas devem ser negativas no DFC Gerencial
        const adjustedAmount = trans.type === 'expense' ? -Math.abs(Number(trans.amount)) : Math.abs(Number(trans.amount));
        grouped[nivel1].total += adjustedAmount;
        grouped[nivel1].level2[nivel2].total += adjustedAmount;
        grouped[nivel1].level2[nivel2].transactions.push({
          ...trans,
          amount: adjustedAmount
        });
      });

      // Remover níveis vazios
      if (Object.keys(grouped['Receitas'].level2).length === 0) {
        delete grouped['Receitas'];
      }
      if (Object.keys(grouped['Despesas'].level2).length === 0) {
        delete grouped['Despesas'];
      }

      setGroupedData(grouped);
    } catch (error: any) {
      console.error('Error loading DFC data:', error);
      toast.error('Erro ao carregar dados: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const exportData: any[] = [];

    Object.entries(groupedData).forEach(([nivel1, l1Data]) => {
      Object.entries(l1Data.level2).forEach(([nivel2, l2Data]) => {
        l2Data.transactions.forEach(trans => {
          exportData.push({
            'Tipo': nivel1,
            'Categoria': nivel2,
            'Descrição': trans.description,
            'Data': new Date(trans.transaction_date).toLocaleDateString('pt-BR'),
            'Valor': trans.amount,
            'Status': trans.status,
            'Entidade': trans.entity_name || ''
          });
        });
      });
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'DFC');
    XLSX.writeFile(wb, `DFC_${school?.slug}_${startDate}_${endDate}.xlsx`);
    toast.success('Arquivo exportado com sucesso!');
  };

  const getDisplayPeriod = () => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return format(start, "MMMM 'de' yyyy", { locale: ptBR });
    }
    return `${format(start, "MMM", { locale: ptBR })} - ${format(end, "MMMM 'de' yyyy", { locale: ptBR })}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent capitalize">
            DFC Gerencial - {getDisplayPeriod()}
          </h1>
          <p className="text-muted-foreground mt-1">
            Demonstração de Fluxo de Caixa agrupada por categorias do Conta Azul
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex gap-2 items-center">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm"
            />
            <span className="text-muted-foreground">até</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <Button onClick={handleExport} variant="outline" size="sm">
            <FileDown className="h-4 w-4 mr-2" />
            Exportar Excel
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {Object.keys(groupedData).length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">
              Nenhuma transação encontrada para este período.
            </p>
          </Card>
        ) : (
          // Ordenar para mostrar Receitas primeiro, depois Despesas
          ['Receitas', 'Despesas']
            .filter(key => groupedData[key])
            .map((nivel1) => (
              <DFCLevel1Item
                key={nivel1}
                nivel1={nivel1}
                total={groupedData[nivel1].total}
                level2Data={groupedData[nivel1].level2}
              />
            ))
        )}
      </div>
    </div>
  );
};
