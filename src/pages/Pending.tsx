import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useSchool } from "@/contexts/SchoolContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PendingStats } from "@/components/PendingStats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download } from "lucide-react";
import * as XLSX from 'xlsx';
import { toast } from "sonner";

interface PendingTransaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  transaction_date: string;
  status: string;
  entity_name: string | null;
  category_name: string | null;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

function prepareChartData(transactions: PendingTransaction[]) {
  const dateMap = new Map<string, { receivables: number, payables: number, receivablesQty: number, payablesQty: number }>();

  transactions.forEach(t => {
    const date = format(new Date(t.transaction_date), 'dd/MM');
    const current = dateMap.get(date) || { receivables: 0, payables: 0, receivablesQty: 0, payablesQty: 0 };
    
    if (t.type === 'income') {
      current.receivables += parseFloat(t.amount.toString());
      current.receivablesQty += 1;
    } else {
      current.payables += parseFloat(t.amount.toString());
      current.payablesQty += 1;
    }
    
    dateMap.set(date, current);
  });

  return Array.from(dateMap.entries()).map(([date, values]) => ({
    date,
    ...values
  })).sort((a, b) => {
    const [dayA, monthA] = a.date.split('/').map(Number);
    const [dayB, monthB] = b.date.split('/').map(Number);
    return monthA === monthB ? dayA - dayB : monthA - monthB;
  });
}

export const Pending = () => {
  const navigate = useNavigate();
  const { school } = useSchool();
  
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<PendingTransaction[]>([]);
  const [selectedType, setSelectedType] = useState<'income' | 'expense'>('income');
  
  const now = new Date();
  const [startDate, setStartDate] = useState(
    format(startOfMonth(now), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(
    format(endOfMonth(now), 'yyyy-MM-dd')
  );
  
  const getDisplayPeriod = () => {
    const start = parseISO(startDate);
    const end = parseISO(endDate);
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return format(start, "MMMM 'de' yyyy", { locale: ptBR });
    }
    return `${format(start, "MMM", { locale: ptBR })} - ${format(end, "MMMM 'de' yyyy", { locale: ptBR })}`;
  };

  useEffect(() => {
    if (!school?.id) {
      navigate("/schools");
    }
  }, [school, navigate]);

  useEffect(() => {
    if (school?.id) {
      loadPendingData();
    }
  }, [school?.id, startDate, endDate]);

  const loadPendingData = async () => {
    if (!school?.id) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('synced_transactions')
        .select('*')
        .eq('school_id', school.id)
        .in('status', ['ATRASADO', 'EM_ABERTO'])
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .order('transaction_date', { ascending: true });

      if (error) throw error;

      const typedData = (data || []).map(item => ({
        ...item,
        type: item.type as 'income' | 'expense'
      }));

      setTransactions(typedData);
    } catch (error) {
      console.error('Erro ao carregar pendências:', error);
      toast.error('Erro ao carregar dados de pendências');
    } finally {
      setLoading(false);
    }
  };

  const pendingReceivables = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);
  
  const receivablesCount = transactions.filter(t => t.type === 'income').length;

  const pendingPayables = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);
  
  const payablesCount = transactions.filter(t => t.type === 'expense').length;

  const chartData = prepareChartData(transactions);
  const filteredTransactions = transactions.filter(t => t.type === selectedType);

  const exportToExcel = () => {
    const dataToExport = filteredTransactions.map(t => ({
      'Tipo': t.type === 'income' ? 'Receber' : 'Pagar',
      'Data': format(new Date(t.transaction_date), 'dd/MM/yyyy'),
      'Descrição': t.description,
      'Entidade': t.entity_name || '-',
      'Categoria': t.category_name || '-',
      'Valor': parseFloat(t.amount.toString()),
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pendências');
    
    const fileName = `pendencias_${selectedType === 'income' ? 'receber' : 'pagar'}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    toast.success('Arquivo exportado com sucesso!');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">
            Pendências - {getDisplayPeriod()}
          </h1>
        </div>
        <p className="text-xs text-muted-foreground italic">
          *Valores pendentes de recebimento/pagamento
        </p>
      </div>

      <PendingStats
        pendingReceivables={pendingReceivables}
        receivablesCount={receivablesCount}
        pendingPayables={pendingPayables}
        payablesCount={payablesCount}
      />

      <Card>
        <CardHeader>
          <CardTitle>Filtrar por Período</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="startDate">Data Inicial</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="endDate">Data Final</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evolução de Pendências</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip 
                formatter={(value: any, name: string, props: any) => {
                  const item = props.payload;
                  if (name === 'receivables') {
                    return [
                      `${formatCurrency(value)} (${item.receivablesQty} pendências)`,
                      'Contas a Receber'
                    ];
                  }
                  if (name === 'payables') {
                    return [
                      `${formatCurrency(value)} (${item.payablesQty} pendências)`,
                      'Contas a Pagar'
                    ];
                  }
                  return [value, name];
                }}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="receivables" 
                stroke="#22c55e" 
                name="Contas a Receber"
                strokeWidth={2}
              />
              <Line 
                type="monotone" 
                dataKey="payables" 
                stroke="#ef4444" 
                name="Contas a Pagar"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex-1">
            <Tabs value={selectedType} onValueChange={(v) => setSelectedType(v as 'income' | 'expense')}>
              <TabsList>
                <TabsTrigger value="income">Contas a Receber</TabsTrigger>
                <TabsTrigger value="expense">Contas a Pagar</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <Button onClick={exportToExcel} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Exportar Excel
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {filteredTransactions.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                Nenhuma pendência encontrada no período
              </p>
            ) : (
              filteredTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50"
                >
                  <div className="flex-1">
                    <p className="font-medium">{transaction.description}</p>
                    <p className="text-sm text-muted-foreground">
                      {transaction.entity_name || 'Sem entidade'} • {transaction.category_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Vencimento: {format(new Date(transaction.transaction_date), 'dd/MM/yyyy')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-semibold ${
                      transaction.type === 'income' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {transaction.type === 'income' ? '+' : '-'} {formatCurrency(parseFloat(transaction.amount.toString()))}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
