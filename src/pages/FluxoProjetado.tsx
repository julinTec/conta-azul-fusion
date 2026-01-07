import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useFaturamentoSheets } from "@/hooks/useFaturamentoSheets";
import { useDespesasSheets } from "@/hooks/useDespesasSheets";

const MONTHS = [
  { value: "01", label: "Janeiro" },
  { value: "02", label: "Fevereiro" },
  { value: "03", label: "Março" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Maio" },
  { value: "06", label: "Junho" },
  { value: "07", label: "Julho" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

const YEARS = ["2026", "2027"];

const SCHOOLS = [
  { slug: "paulo-freire", name: "Paulo Freire" },
  { slug: "renascer", name: "Renascer" },
  { slug: "conectivo", name: "Conectivo" },
  { slug: "aventurando", name: "Aventurando" },
  { slug: "crista-gomes", name: "Cristã Gomes" },
  { slug: "exodus", name: "Exodus" },
];

const FluxoProjetado = () => {
  const navigate = useNavigate();
  const { data: faturamentoData, isLoading: loadingFat, refetch: refetchFat } = useFaturamentoSheets();
  const { data: despesasData, isLoading: loadingDesp, refetch: refetchDesp } = useDespesasSheets();
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [graphMonth, setGraphMonth] = useState<string>("all");
  const [graphYear, setGraphYear] = useState<string>("all");
  const [graphSchool, setGraphSchool] = useState<string>("all");
  const [detailView, setDetailView] = useState<string>("faturamento");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  
  const isLoading = loadingFat || loadingDesp;
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchFat(), refetchDesp()]);
    setIsRefreshing(false);
  };

  const clearFilters = () => {
    setSelectedDate(undefined);
    setSelectedMonth("all");
    setSelectedYear("all");
  };

  // Filter faturamento data (2026+)
  const filteredFaturamento = useMemo(() => {
    if (!faturamentoData?.items) return [];
    
    return faturamentoData.items.filter(item => {
      if (!item.dataVencimento) return false;
      
      const itemYear = parseInt(item.dataVencimento.substring(0, 4), 10);
      if (itemYear < 2026) return false;
      
      // Filter by selected date
      if (selectedDate) {
        const itemDate = item.dataVencimento;
        const filterDate = format(selectedDate, "yyyy-MM-dd");
        if (itemDate !== filterDate) return false;
      }
      
      // Filter by month
      if (selectedMonth !== "all") {
        const itemMonth = item.dataVencimento.substring(5, 7);
        if (itemMonth !== selectedMonth) return false;
      }
      
      // Filter by year
      if (selectedYear !== "all") {
        const year = item.dataVencimento.substring(0, 4);
        if (year !== selectedYear) return false;
      }
      
      return true;
    });
  }, [faturamentoData, selectedDate, selectedMonth, selectedYear]);

  // Filter despesas data (2026+)
  const filteredDespesas = useMemo(() => {
    if (!despesasData?.items) return [];
    
    return despesasData.items.filter(item => {
      if (!item.dataVencimento) return false;
      
      const itemYear = parseInt(item.dataVencimento.substring(0, 4), 10);
      if (itemYear < 2026) return false;
      
      // Filter by selected date
      if (selectedDate) {
        const itemDate = item.dataVencimento;
        const filterDate = format(selectedDate, "yyyy-MM-dd");
        if (itemDate !== filterDate) return false;
      }
      
      // Filter by month
      if (selectedMonth !== "all") {
        const itemMonth = item.dataVencimento.substring(5, 7);
        if (itemMonth !== selectedMonth) return false;
      }
      
      // Filter by year
      if (selectedYear !== "all") {
        const year = item.dataVencimento.substring(0, 4);
        if (year !== selectedYear) return false;
      }
      
      return true;
    });
  }, [despesasData, selectedDate, selectedMonth, selectedYear]);

  // School summary cards
  const schoolSummary = useMemo(() => {
    return SCHOOLS.map(school => {
      const faturamento = filteredFaturamento
        .filter(item => item.escolaSlug === school.slug)
        .reduce((sum, item) => sum + item.valor, 0);
      
      const despesas = filteredDespesas
        .filter(item => item.escolaSlug === school.slug)
        .reduce((sum, item) => sum + item.valor, 0);
      
      return {
        ...school,
        faturamento,
        despesas,
        saldo: faturamento - despesas,
      };
    });
  }, [filteredFaturamento, filteredDespesas]);

  // Chart data - filtered by graph filters
  const chartData = useMemo(() => {
    const fatItems = (faturamentoData?.items || []).filter(item => {
      if (!item.dataVencimento) return false;
      const itemYear = parseInt(item.dataVencimento.substring(0, 4), 10);
      if (itemYear < 2026) return false;
      
      if (graphMonth !== "all") {
        const itemMonth = item.dataVencimento.substring(5, 7);
        if (itemMonth !== graphMonth) return false;
      }
      
      if (graphYear !== "all") {
        const year = item.dataVencimento.substring(0, 4);
        if (year !== graphYear) return false;
      }
      
      if (graphSchool !== "all" && item.escolaSlug !== graphSchool) return false;
      
      return true;
    });
    
    const despItems = (despesasData?.items || []).filter(item => {
      if (!item.dataVencimento) return false;
      const itemYear = parseInt(item.dataVencimento.substring(0, 4), 10);
      if (itemYear < 2026) return false;
      
      if (graphMonth !== "all") {
        const itemMonth = item.dataVencimento.substring(5, 7);
        if (itemMonth !== graphMonth) return false;
      }
      
      if (graphYear !== "all") {
        const year = item.dataVencimento.substring(0, 4);
        if (year !== graphYear) return false;
      }
      
      if (graphSchool !== "all" && item.escolaSlug !== graphSchool) return false;
      
      return true;
    });
    
    // Group by date
    const dailyData: Record<string, { faturamento: number; despesas: number }> = {};
    
    fatItems.forEach(item => {
      const date = item.dataVencimento;
      if (!dailyData[date]) {
        dailyData[date] = { faturamento: 0, despesas: 0 };
      }
      dailyData[date].faturamento += item.valor;
    });
    
    despItems.forEach(item => {
      const date = item.dataVencimento;
      if (!dailyData[date]) {
        dailyData[date] = { faturamento: 0, despesas: 0 };
      }
      dailyData[date].despesas += item.valor;
    });
    
    // Convert to array and sort by date
    return Object.entries(dailyData)
      .map(([date, values]) => ({
        date,
        displayDate: format(parseISO(date), "dd/MM", { locale: ptBR }),
        faturamento: values.faturamento,
        despesas: values.despesas,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [faturamentoData, despesasData, graphMonth, graphYear, graphSchool]);

  // Table data
  const tableData = useMemo(() => {
    if (detailView === "faturamento") {
      return filteredFaturamento;
    } else {
      return filteredDespesas;
    }
  }, [detailView, filteredFaturamento, filteredDespesas]);

  const paginatedItems = tableData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(tableData.length / itemsPerPage);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    try {
      return format(parseISO(dateStr), "dd/MM/yyyy", { locale: ptBR });
    } catch {
      return dateStr;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/schools")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Fluxo Projetado - Escolas</h1>
        </div>
        <Button
          onClick={handleRefresh}
          variant="outline"
          className="gap-2"
          disabled={isRefreshing}
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Global Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[200px] justify-start">
                  {selectedDate ? format(selectedDate, "dd/MM/yyyy") : "Selecionar Data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  locale={ptBR}
                />
              </PopoverContent>
            </Popover>

            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Mês" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os meses</SelectItem>
                {MONTHS.map((month) => (
                  <SelectItem key={month.value} value={month.value}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[120px]">
                <SelectValue placeholder="Ano" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {YEARS.map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="ghost" onClick={clearFilters}>
              Limpar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* School Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {schoolSummary.map((school) => (
          <Card key={school.slug}>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{school.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Faturamento</span>
                <span className="font-semibold text-green-600">
                  {formatCurrency(school.faturamento)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Despesas</span>
                <span className="font-semibold text-red-600">
                  {formatCurrency(school.despesas)}
                </span>
              </div>
              <div className="border-t pt-2 flex justify-between items-center">
                <span className="text-sm font-medium">Saldo</span>
                <span
                  className={`font-bold ${
                    school.saldo >= 0 ? "text-blue-600" : "text-red-600"
                  }`}
                >
                  {formatCurrency(school.saldo)}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <CardTitle>Faturamento x Despesas por Dia</CardTitle>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={graphMonth} onValueChange={setGraphMonth}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Mês" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os meses</SelectItem>
                  {MONTHS.map((month) => (
                    <SelectItem key={month.value} value={month.value}>
                      {month.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={graphYear} onValueChange={setGraphYear}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Ano" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {YEARS.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={graphSchool} onValueChange={setGraphSchool}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Escola" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as escolas</SelectItem>
                  {SCHOOLS.map((school) => (
                    <SelectItem key={school.slug} value={school.slug}>
                      {school.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="displayDate" tick={{ fontSize: 12 }} />
                <YAxis
                  tickFormatter={(value) =>
                    new Intl.NumberFormat("pt-BR", {
                      notation: "compact",
                      compactDisplay: "short",
                    }).format(value)
                  }
                />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  labelFormatter={(label) => `Data: ${label}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="faturamento"
                  name="Faturamento"
                  stroke="hsl(142, 76%, 36%)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="despesas"
                  name="Despesas"
                  stroke="hsl(0, 84%, 60%)"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Detail Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle>Detalhado</CardTitle>
              <p className="text-sm text-muted-foreground">
                {tableData.length} registros encontrados
              </p>
            </div>
            <ToggleGroup
              type="single"
              value={detailView}
              onValueChange={(value) => {
                if (value) {
                  setDetailView(value);
                  setCurrentPage(1);
                }
              }}
            >
              <ToggleGroupItem value="faturamento" className="px-4">
                Faturamento
              </ToggleGroupItem>
              <ToggleGroupItem value="despesas" className="px-4">
                Despesas
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Escola</TableHead>
                  <TableHead>Data de Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  {detailView === "faturamento" ? (
                    <>
                      <TableHead>Série</TableHead>
                      <TableHead>Status</TableHead>
                    </>
                  ) : (
                    <TableHead>Descrição</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={detailView === "faturamento" ? 5 : 4}
                      className="text-center py-8 text-muted-foreground"
                    >
                      Nenhum registro encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedItems.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.escola}</TableCell>
                      <TableCell>{formatDate(item.dataVencimento)}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(item.valor)}
                      </TableCell>
                      {detailView === "faturamento" ? (
                        <>
                          <TableCell>
                            {"serie" in item ? (item as any).serie || "-" : "-"}
                          </TableCell>
                          <TableCell>
                            {"status" in item ? (item as any).status || "-" : "-"}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell>
                          {"descricao" in item ? (item as any).descricao || "-" : "-"}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    return (
                      <PaginationItem key={pageNum}>
                        <PaginationLink
                          onClick={() => setCurrentPage(pageNum)}
                          isActive={currentPage === pageNum}
                          className="cursor-pointer"
                        >
                          {pageNum}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FluxoProjetado;
