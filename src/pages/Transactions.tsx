import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Search, Filter, ArrowUpCircle, ArrowDownCircle, FileDown } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import * as XLSX from 'xlsx';
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TransactionStats } from "@/components/TransactionStats";
import { useSchool } from "@/contexts/SchoolContext";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Transaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  description: string;
  date: string;
  status?: string;
  category?: {
    name: string;
    color: string;
  };
}

export const Transactions = () => {
  const getPreviousMonthDates = () => {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    return { 
      start: firstDay.toISOString().split('T')[0], 
      end: lastDay.toISOString().split('T')[0] 
    };
  };

  const { start, end } = getPreviousMonthDates();
  
  const navigate = useNavigate();
  const { school, loading: schoolLoading } = useSchool();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState(start);
  const [endDate, setEndDate] = useState(end);
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const uniqueCategories = useMemo(() => {
    const categories = new Set<string>();
    transactions.forEach(t => {
      if (t.category?.name) categories.add(t.category.name);
    });
    return Array.from(categories).sort();
  }, [transactions]);

  useEffect(() => {
    if (!schoolLoading && !school) {
      navigate('/schools');
    }
  }, [school, schoolLoading, navigate]);

  useEffect(() => {
    if (school?.id) {
      loadTransactions();
    }
  }, [school?.id]);

  useEffect(() => {
    filterTransactions();
  }, [searchTerm, startDate, endDate, transactions, typeFilter, categoryFilter]);

  const fetchAllTransactions = async () => {
    if (!school?.id) return [];
    
    const pageSize = 1000;
    let from = 0;
    let to = pageSize - 1;
    const all: any[] = [];

    while (true) {
      const { data: batch, error } = await supabase
        .from('synced_transactions')
        .select('*')
        .eq('school_id', school.id)
        .eq('status', 'RECEBIDO')
        .order('transaction_date', { ascending: false })
        .range(from, to);

      if (error) throw error;
      if (!batch || batch.length === 0) break;

      all.push(...batch);
      if (batch.length < pageSize) break;

      from += pageSize;
      to += pageSize;
    }

    return all;
  };

  const loadTransactions = async () => {
    try {
      setLoading(true);
      
      // Buscar todas as transações com paginação
      const data = await fetchAllTransactions();

      console.log('Transactions page - total loaded:', data.length);

      if (!data || data.length === 0) {
        toast.info("Nenhum dado disponível. Aguarde a sincronização.");
        setLoading(false);
        return;
      }

      const allTransactions = data.map((item: any) => ({
        id: item.id,
        type: item.type as 'income' | 'expense',
        amount: parseFloat(item.amount),
        description: item.description,
        date: item.transaction_date,
        status: item.status,
        category: {
          name: item.category_name || (item.type === 'income' ? 'Receita' : 'Despesa'),
          color: item.category_color || (item.type === 'income' ? '#22c55e' : '#ef4444'),
        },
      }));

      setTransactions(allTransactions);
      setFilteredTransactions(allTransactions);
    } catch (error: any) {
      console.error("Error loading transactions:", error);
      toast.error("Erro ao carregar lançamentos");
    } finally {
      setLoading(false);
    }
  };

  const filterTransactions = () => {
    let filtered = [...transactions];

    // Filter by type
    if (typeFilter !== 'all') {
      filtered = filtered.filter(t => t.type === typeFilter);
    }

    // Filter by category
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(t => t.category?.name === categoryFilter);
    }

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(t => 
        t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.category?.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Filter by date range
    if (startDate) {
      filtered = filtered.filter(t => t.date >= startDate);
    }
    if (endDate) {
      filtered = filtered.filter(t => t.date <= endDate);
    }

    // Sort by date descending
    filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    setFilteredTransactions(filtered);
  };

  const clearFilters = () => {
    setSearchTerm("");
    const { start, end } = getPreviousMonthDates();
    setStartDate(start);
    setEndDate(end);
    setTypeFilter('all');
    setCategoryFilter('all');
  };

  const getDisplayPeriod = () => {
    if (!startDate || !endDate) return 'Todos os períodos';
    const [sYear, sMonth] = startDate.split('-').map(Number);
    const [eYear, eMonth] = endDate.split('-').map(Number);
    const start = new Date(sYear, sMonth - 1, 1);
    const end = new Date(eYear, eMonth - 1, 1);
    if (sMonth === eMonth && sYear === eYear) {
      return format(start, "MMMM 'de' yyyy", { locale: ptBR });
    }
    return `${format(start, "MMM", { locale: ptBR })} - ${format(end, "MMMM 'de' yyyy", { locale: ptBR })}`;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    const [year, month, day] = dateString.split('-');
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString('pt-BR');
  };

  const exportToExcel = () => {
    if (filteredTransactions.length === 0) {
      toast.error("Não há lançamentos para exportar");
      return;
    }

    // Preparar dados para exportação
    const exportData = filteredTransactions.map(transaction => ({
      'Data': formatDate(transaction.date),
      'Tipo': transaction.type === 'income' ? 'Recebimento' : 'Despesa',
      'Descrição': transaction.description,
      'Categoria': transaction.category?.name || '-',
      'Status': transaction.status || '-',
      'Valor': transaction.amount,
    }));

    // Criar workbook e worksheet
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lançamentos');

    // Ajustar largura das colunas
    const colWidths = [
      { wch: 12 }, // Data
      { wch: 15 }, // Tipo
      { wch: 40 }, // Descrição
      { wch: 20 }, // Categoria
      { wch: 15 }, // Status
      { wch: 15 }, // Valor
    ];
    ws['!cols'] = colWidths;

    // Gerar arquivo
    const fileName = `lancamentos_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    toast.success(`Relatório exportado com sucesso! ${filteredTransactions.length} lançamento(s)`);
  };

  if (loading || schoolLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!school) {
    return null;
  }

  const incomeTransactions = filteredTransactions.filter(t => t.type === 'income');
  const expenseTransactions = filteredTransactions.filter(t => t.type === 'expense');
  const totalIncome = incomeTransactions.reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="space-y-6">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-primary">{school.name}</h1>
      </div>
      
      <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold">
              Lançamentos - {getDisplayPeriod()}
            </h2>
          <p className="text-muted-foreground mt-2">
            Visualize todos os lançamentos de receitas e despesas
          </p>
        </div>
        <p className="text-sm text-muted-foreground italic">
          *Contém os valores de Aportes.
        </p>
      </div>

      <TransactionStats
        incomeCount={incomeTransactions.length}
        expenseCount={expenseTransactions.length}
        totalIncome={totalIncome}
        totalExpense={totalExpense}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtros
          </CardTitle>
          <CardDescription>
            Filtre os lançamentos por descrição, categoria ou período
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="md:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por descrição..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as categorias" />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  {uniqueCategories.map(category => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Input
                type="date"
                placeholder="Data inicial"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Input
                type="date"
                placeholder="Data final"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            {(searchTerm || startDate || endDate || categoryFilter !== 'all') && (
              <Button onClick={clearFilters} variant="outline" size="sm">
                Limpar Filtros
              </Button>
            )}
            <Button onClick={exportToExcel} variant="default" size="sm" className="gap-2">
              <FileDown className="h-4 w-4" />
              Exportar para Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4 bg-card p-4 rounded-lg border">
        <span className="text-sm font-medium">Exibir:</span>
        <ToggleGroup 
          type="single" 
          value={typeFilter} 
          onValueChange={(value) => value && setTypeFilter(value as 'all' | 'income' | 'expense')}
        >
          <ToggleGroupItem value="all" aria-label="Todas">
            Todas
          </ToggleGroupItem>
          <ToggleGroupItem value="income" aria-label="Receitas" className="gap-2">
            <ArrowUpCircle className="h-4 w-4 text-green-500" />
            Receitas
          </ToggleGroupItem>
          <ToggleGroupItem value="expense" aria-label="Despesas" className="gap-2">
            <ArrowDownCircle className="h-4 w-4 text-red-500" />
            Despesas
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {filteredTransactions.length} Lançamento(s)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredTransactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Nenhum lançamento encontrado
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTransactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className={`p-2 rounded-full ${
                      transaction.type === 'income' 
                        ? 'bg-green-100 text-green-600' 
                        : 'bg-red-100 text-red-600'
                    }`}>
                      {transaction.type === 'income' ? (
                        <ArrowUpCircle className="h-5 w-5" />
                      ) : (
                        <ArrowDownCircle className="h-5 w-5" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{transaction.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(transaction.date)}
                        </span>
                        {transaction.category && (
                          <Badge variant="outline" className="text-xs">
                            {transaction.category.name}
                          </Badge>
                        )}
                        {transaction.status && (
                          <Badge variant="secondary" className="text-xs">
                            {transaction.status}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className={`text-lg font-semibold ${
                    transaction.type === 'income' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {transaction.type === 'income' ? '+' : '-'} {formatCurrency(transaction.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
