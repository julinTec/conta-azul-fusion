import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ArrowLeft, Calendar, TrendingUp, Users, FileText, DollarSign, Loader2, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFaturamentoSheets } from "@/hooks/useFaturamentoSheets";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";
import { cn } from "@/lib/utils";
import * as XLSX from 'xlsx';

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

const YEARS = ["2025", "2026", "2027"];

const SCHOOL_COLORS: Record<string, string> = {
  "paulo-freire": "hsl(var(--primary))",
  "renascer": "hsl(142, 76%, 36%)",
  "conectivo": "hsl(0, 84%, 60%)",
  "aventurando": "hsl(25, 95%, 53%)",
  "crista-gomes": "hsl(280, 65%, 50%)",
};

const SCHOOL_OPTIONS = [
  { value: "paulo-freire", label: "Colégio Paulo Freire" },
  { value: "renascer", label: "Colégio Renascer" },
  { value: "conectivo", label: "Colégio Conectivo" },
  { value: "aventurando", label: "Colégio Aventurando" },
  { value: "crista-gomes", label: "Colégio Cristã Gomes" },
];

const FaturamentoProjetado = () => {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching } = useFaturamentoSheets();

  const handleRefresh = async () => {
    await refetch();
  };
  
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedMonth, setSelectedMonth] = useState<string>("all");
  const [selectedYear, setSelectedYear] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [selectedSchool, setSelectedSchool] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const filteredItems = useMemo(() => {
    if (!data?.items) return [];
    
    return data.items.filter(item => {
      // Filter by school
      if (selectedSchool !== "all" && item.escolaSlug !== selectedSchool) {
        return false;
      }
      
      // Filter by date
      if (selectedDate && item.dataVencimento) {
        const itemDate = item.dataVencimento.split('T')[0];
        const filterDate = format(selectedDate, 'yyyy-MM-dd');
        if (itemDate !== filterDate) return false;
      }
      
      // Filter by month
      if (selectedMonth !== "all" && item.dataVencimento) {
        const itemMonth = item.dataVencimento.substring(5, 7);
        if (itemMonth !== selectedMonth) return false;
      }
      
      // Filter by year
      if (selectedYear !== "all" && item.dataVencimento) {
        const itemYear = item.dataVencimento.substring(0, 4);
        if (itemYear !== selectedYear) return false;
      }
      
      // Filter by status
      if (selectedStatus !== "all" && item.status) {
        if (item.status.toLowerCase() !== selectedStatus.toLowerCase()) return false;
      }
      
      return true;
    });
  }, [data?.items, selectedDate, selectedMonth, selectedYear, selectedStatus, selectedSchool]);

  const hasActiveFilters = selectedDate || selectedMonth !== "all" || selectedYear !== "all" || selectedStatus !== "all" || selectedSchool !== "all";

  const filteredResumos = useMemo(() => {
    const schools = ["paulo-freire", "renascer", "conectivo", "aventurando", "crista-gomes"];
    const schoolNames: Record<string, string> = {
      "paulo-freire": "Colégio Paulo Freire",
      "renascer": "Colégio Renascer",
      "conectivo": "Colégio Conectivo",
      "aventurando": "Colégio Aventurando",
      "crista-gomes": "Colégio Cristã Gomes",
    };
    
    // Use filteredItems if filters are active, otherwise use all items
    const itemsToUse = hasActiveFilters ? filteredItems : (data?.items || []);
    
    return schools.map(slug => {
      const schoolItems = itemsToUse.filter(item => item.escolaSlug === slug);
      const uniqueStudents = new Set(schoolItems.map(item => item.nomeAluno)).size;
      const totalFaturamento = schoolItems.reduce((sum, item) => sum + item.valor, 0);
      const totalPendente = schoolItems
        .filter(item => item.status?.toLowerCase() === "pendente")
        .reduce((sum, item) => sum + item.valor, 0);
      const totalBoletos = schoolItems.length;
      const percentualInadimplencia = totalFaturamento > 0 ? (totalPendente / totalFaturamento) * 100 : 0;
      
      return {
        escola: schoolNames[slug],
        escolaSlug: slug,
        totalFaturamento,
        totalPendente,
        percentualInadimplencia,
        totalAlunos: uniqueStudents,
        totalBoletos,
        ticketMedio: totalBoletos > 0 ? totalFaturamento / totalBoletos : 0,
      };
    });
  }, [filteredItems, data?.items, hasActiveFilters]);

  const monthlyChartData = useMemo(() => {
    if (!data?.items) return [];
    
    const monthlyData: Record<string, Record<string, number>> = {};
    
    data.items.forEach(item => {
      if (!item.dataVencimento || item.dataVencimento.length < 7) return;
      const monthKey = item.dataVencimento.substring(0, 7); // YYYY-MM
      
      // Validate format YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = {
          "paulo-freire": 0,
          "renascer": 0,
          "conectivo": 0,
          "aventurando": 0,
          "crista-gomes": 0,
        };
      }
      
      monthlyData[monthKey][item.escolaSlug] += item.valor;
    });
    
    return Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => {
        try {
          const date = parseISO(`${month}-01`);
          if (isNaN(date.getTime())) return null;
          return {
            month: format(date, "MMM/yy", { locale: ptBR }),
            "Paulo Freire": values["paulo-freire"],
            "Renascer": values["renascer"],
            "Conectivo": values["conectivo"],
            "Aventurando": values["aventurando"],
            "Cristã Gomes": values["crista-gomes"],
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }, [data?.items]);

  // Chart data for "Acompanhamento Inadimplência" - only pendente items
  const monthlyPendenteChartData = useMemo(() => {
    if (!data?.items) return [];
    
    const monthlyData: Record<string, Record<string, number>> = {};
    
    data.items
      .filter(item => item.status?.toLowerCase() === "pendente")
      .forEach(item => {
        if (!item.dataVencimento || item.dataVencimento.length < 7) return;
        const monthKey = item.dataVencimento.substring(0, 7); // YYYY-MM
        
        // Validate format YYYY-MM
        if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
        
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = {
            "paulo-freire": 0,
            "renascer": 0,
            "conectivo": 0,
            "aventurando": 0,
            "crista-gomes": 0,
          };
        }
        
        monthlyData[monthKey][item.escolaSlug] += item.valor;
      });
    
    return Object.entries(monthlyData)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, values]) => {
        try {
          const date = parseISO(`${month}-01`);
          if (isNaN(date.getTime())) return null;
          return {
            month: format(date, "MMM/yy", { locale: ptBR }),
            "Paulo Freire": values["paulo-freire"],
            "Renascer": values["renascer"],
            "Conectivo": values["conectivo"],
            "Aventurando": values["aventurando"],
            "Cristã Gomes": values["crista-gomes"],
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }, [data?.items]);

  const clearFilters = () => {
    setSelectedDate(undefined);
    setSelectedMonth("all");
    setSelectedYear("all");
    setSelectedStatus("all");
    setSelectedSchool("all");
    setCurrentPage(1);
  };

  const exportToExcel = () => {
    const dataToExport = filteredItems.map(item => ({
      'Escola': item.escola,
      'Aluno': item.nomeAluno,
      'Responsável': item.nomeResponsavel,
      'Vencimento': formatDate(item.dataVencimento),
      'Valor Bruto': item.valorBruto,
      'Desconto': item.desconto,
      'Valor': item.valor,
      'Série': item.serie,
      'Status': item.status,
    }));
    
    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Faturamento");
    XLSX.writeFile(wb, `faturamento-projetado-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const paginatedItems = filteredItems.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredItems.length / itemsPerPage);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "-";
    try {
      return format(parseISO(dateStr), "dd/MM/yyyy");
    } catch {
      return dateStr;
    }
  };

  const STATUS_OPTIONS = [
    { value: "pendente", label: "Pendente" },
    { value: "pago", label: "Pago" },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">Erro ao carregar dados</p>
          <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/schools")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl md:text-3xl font-bold text-foreground">
              Faturamento Projetado
            </h1>
          </div>
          <Button 
            variant="outline" 
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", isFetching && "animate-spin")} />
            {isFetching ? "Atualizando..." : "Atualizar"}
          </Button>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Data</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-[180px] justify-start text-left font-normal",
                        !selectedDate && "text-muted-foreground"
                      )}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {selectedDate ? format(selectedDate, "dd/MM/yyyy") : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <CalendarComponent
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Mês</label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {MONTHS.map(month => (
                      <SelectItem key={month.value} value={month.value}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Ano</label>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {YEARS.map(year => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {STATUS_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button variant="outline" onClick={clearFilters}>
                Limpar Filtros
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {filteredResumos.map((resumo) => (
            <Card key={resumo.escolaSlug} className="border-l-4" style={{ borderLeftColor: SCHOOL_COLORS[resumo.escolaSlug] }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {resumo.escola}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xl font-bold">{formatCurrency(resumo.totalFaturamento)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-1">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span>{resumo.totalAlunos} alunos</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <FileText className="h-3 w-3 text-muted-foreground" />
                    <span>{resumo.totalBoletos} boletos</span>
                  </div>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Ticket médio: {formatCurrency(resumo.ticketMedio)}</span>
                  <span className="font-medium text-destructive">
                    % Inad: {resumo.percentualInadimplencia.toFixed(1)}%
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Faturamento Mensal (projetado) por Escola
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(value) => `R$ ${(value / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="Paulo Freire" fill={SCHOOL_COLORS["paulo-freire"]} />
                  <Bar dataKey="Renascer" fill={SCHOOL_COLORS["renascer"]} />
                  <Bar dataKey="Conectivo" fill={SCHOOL_COLORS["conectivo"]} />
                  <Bar dataKey="Aventurando" fill={SCHOOL_COLORS["aventurando"]} />
                  <Bar dataKey="Cristã Gomes" fill={SCHOOL_COLORS["crista-gomes"]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Acompanhamento Inadimplência
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={monthlyPendenteChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(value) => `R$ ${(value / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Line type="monotone" dataKey="Paulo Freire" stroke={SCHOOL_COLORS["paulo-freire"]} strokeWidth={2} />
                  <Line type="monotone" dataKey="Renascer" stroke={SCHOOL_COLORS["renascer"]} strokeWidth={2} />
                  <Line type="monotone" dataKey="Conectivo" stroke={SCHOOL_COLORS["conectivo"]} strokeWidth={2} />
                  <Line type="monotone" dataKey="Aventurando" stroke={SCHOOL_COLORS["aventurando"]} strokeWidth={2} />
                  <Line type="monotone" dataKey="Cristã Gomes" stroke={SCHOOL_COLORS["crista-gomes"]} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Table */}
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle>Detalhamento</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {filteredItems.length} registros encontrados
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Select value={selectedSchool} onValueChange={setSelectedSchool}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Todas as escolas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as escolas</SelectItem>
                    {SCHOOL_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={exportToExcel} variant="outline" className="gap-2">
                  <Download className="h-4 w-4" />
                  Exportar Excel
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Escola</TableHead>
                    <TableHead>Aluno</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor Bruto</TableHead>
                    <TableHead>Desconto</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Série</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        Nenhum registro encontrado
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedItems.map((item, index) => (
                      <TableRow key={`${item.escolaSlug}-${item.nomeAluno}-${index}`}>
                        <TableCell className="font-medium">{item.escola}</TableCell>
                        <TableCell>{item.nomeAluno}</TableCell>
                        <TableCell>{item.nomeResponsavel}</TableCell>
                        <TableCell>{formatDate(item.dataVencimento)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(item.valorBruto)}</TableCell>
                        <TableCell>{item.desconto}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(item.valor)}</TableCell>
                        <TableCell>{item.serie}</TableCell>
                        <TableCell>{item.status}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">
                  Página {currentPage} de {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default FaturamentoProjetado;
