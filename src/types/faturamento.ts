export interface FaturamentoItem {
  escola: string;
  escolaSlug: string;
  nomeAluno: string;
  nomeResponsavel: string;
  dataVencimento: string;
  valorBruto: number;
  desconto: string;
  valor: number;
  serie: string;
  status: string;
}

export interface ResumoEscola {
  escola: string;
  escolaSlug: string;
  totalFaturamento: number;
  totalAlunos: number;
  totalBoletos: number;
  ticketMedio: number;
}

export interface FaturamentoData {
  items: FaturamentoItem[];
  resumos: ResumoEscola[];
}

export interface DespesaItem {
  escola: string;
  escolaSlug: string;
  dataVencimento: string;
  descricao: string;
  valor: number;
}

export interface ReformaItem {
  escola: string;
  escolaSlug: string;
  dataVencimento: string;
  descricao: string;
  valor: number;
}

export interface DespesasData {
  items: DespesaItem[];
  reformas: ReformaItem[];
}
