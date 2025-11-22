import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, FileDown, AlertCircle } from "lucide-react";
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
}

interface MappedTransaction extends Transaction {
  nivel_1: string;
  nivel_2: string;
  categoria: string | null;
}

interface Level2Group {
  total: number;
  transactions: MappedTransaction[];
}

interface Level1Group {
  total: number;
  level2: Record<string, Level2Group>;
}

export const DFCGerencial = () => {
  const { school } = useSchool();
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<MappedTransaction[]>([]);
  const [unmappedTransactions, setUnmappedTransactions] = useState<Transaction[]>([]);
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
      // Buscar transações
      const { data: transData, error: transError } = await supabase
        .from('synced_transactions')
        .select('*')
        .eq('school_id', school.id)
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .order('transaction_date', { ascending: false });

      if (transError) throw transError;

      // Buscar mapeamentos
      const { data: mappingData, error: mappingError } = await supabase
        .from('dfc_mapping')
        .select('*')
        .eq('school_id', school.id);

      if (mappingError) throw mappingError;

      // Criar mapa de descrição -> mapeamento
      const mappingMap = new Map(
        (mappingData || []).map(m => [m.descricao.toLowerCase().trim(), m])
      );

      const mapped: MappedTransaction[] = [];
      const unmapped: Transaction[] = [];

      (transData || []).forEach(trans => {
        const mapping = mappingMap.get(trans.description.toLowerCase().trim());
        
        if (mapping) {
          mapped.push({
            ...trans,
            nivel_1: mapping.nivel_1,
            nivel_2: mapping.nivel_2,
            categoria: mapping.categoria
          });
        } else {
          unmapped.push(trans);
        }
      });

      setTransactions(mapped);
      setUnmappedTransactions(unmapped);

      // Agrupar dados hierarquicamente
      const grouped: Record<string, Level1Group> = {};

      mapped.forEach(trans => {
        if (!grouped[trans.nivel_1]) {
          grouped[trans.nivel_1] = { total: 0, level2: {} };
        }

        if (!grouped[trans.nivel_1].level2[trans.nivel_2]) {
          grouped[trans.nivel_1].level2[trans.nivel_2] = {
            total: 0,
            transactions: []
          };
        }

        const amount = Number(trans.amount);
        grouped[trans.nivel_1].total += amount;
        grouped[trans.nivel_1].level2[trans.nivel_2].total += amount;
        grouped[trans.nivel_1].level2[trans.nivel_2].transactions.push(trans);
      });

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
            'Nível 1': nivel1,
            'Nível 2': nivel2,
            'Categoria': trans.categoria || '',
            'Descrição': trans.description,
            'Data': new Date(trans.transaction_date).toLocaleDateString('pt-BR'),
            'Tipo': trans.type === 'income' ? 'Receita' : 'Despesa',
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

  const currentMonthName = format(new Date(startDate), "MMMM 'de' yyyy", { locale: ptBR });

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
            DFC Gerencial - {currentMonthName}
          </h1>
          <p className="text-muted-foreground mt-1">
            Demonstração de Fluxo de Caixa estruturada por categorias
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

      {unmappedTransactions.length > 0 && (
        <Card className="p-4 bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-800 dark:text-yellow-200">
                Transações Não Classificadas
              </h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                {unmappedTransactions.length} transação(ões) sem mapeamento DE-PARA.
                Configure o mapeamento no painel administrativo.
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {Object.keys(groupedData).length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">
              Nenhuma transação classificada encontrada para este período.
            </p>
          </Card>
        ) : (
          Object.entries(groupedData)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([nivel1, data]) => (
              <DFCLevel1Item
                key={nivel1}
                nivel1={nivel1}
                total={data.total}
                level2Data={data.level2}
              />
            ))
        )}
      </div>
    </div>
  );
};