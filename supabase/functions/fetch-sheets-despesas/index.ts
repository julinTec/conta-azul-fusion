import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const SPREADSHEET_ID = '1s0-r-kXJdTqJHUiZ9xijdLWOUX_7WClnih2C5tgNi1Q';
const SHEET_NAME = 'CAP 2026';
const SHEET_NAME_REFORMA = 'REFORMA';

interface DespesaItem {
  escola: string;
  escolaSlug: string;
  dataVencimento: string;
  descricao: string;
  valor: number;
}

interface ReformaItem {
  escola: string;
  escolaSlug: string;
  dataVencimento: string;
  descricao: string;
  valor: number;
}

const SCHOOL_MAPPING: Record<string, string> = {
  'CRISTÃ GOMES': 'crista-gomes',
  'CRISTÃ-GOMES': 'crista-gomes',
  'CRISTA GOMES': 'crista-gomes',
  'CRISTA-GOMES': 'crista-gomes',
  'RENASCER': 'renascer',
  'EXODUS': 'exodus',
  'PAULO FREIRE': 'paulo-freire',
  'CONECTIVO': 'conectivo',
  'AVENTURANDO': 'aventurando',
  'CARPE DIEM': 'carpe-diem',
};

function excelSerialToDate(serial: number): string {
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDate(value: unknown): string {
  if (!value) return '';
  
  // Handle Excel serial numbers
  if (typeof value === 'number') {
    return excelSerialToDate(value);
  }
  
  const strValue = String(value).trim();
  if (!strValue) return '';
  
  // Handle Google Visualization API date format: Date(YYYY,M,D)
  const gvizMatch = strValue.match(/Date\((\d+),(\d+),(\d+)\)/);
  if (gvizMatch) {
    const year = parseInt(gvizMatch[1], 10);
    const month = parseInt(gvizMatch[2], 10) + 1;
    const day = parseInt(gvizMatch[3], 10);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  
  // Handle dd/MM/yyyy format (4-digit year)
  const brMatch = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, '0');
    const month = brMatch[2].padStart(2, '0');
    const year = brMatch[3];
    return `${year}-${month}-${day}`;
  }
  
  // Handle dd/MM/yy format (2-digit year)
  const brMatch2Digit = strValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (brMatch2Digit) {
    const day = brMatch2Digit[1].padStart(2, '0');
    const month = brMatch2Digit[2].padStart(2, '0');
    const yearShort = brMatch2Digit[3];
    const year = `20${yearShort}`;
    return `${year}-${month}-${day}`;
  }
  
  // Handle yyyy-MM-dd format
  const isoMatch = strValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return strValue;
  }
  
  return '';
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number') return Math.abs(value);
  if (!value) return 0;
  
  const strValue = String(value).trim();
  if (!strValue) return 0;
  
  // Remove currency symbols and spaces
  let cleaned = strValue.replace(/[R$\s]/g, '');
  
  // Handle Brazilian format: 1.234,56 -> 1234.56
  if (cleaned.includes(',')) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  }
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.abs(num);
}

function getSchoolSlug(schoolName: string): string {
  if (!schoolName) return '';
  const normalized = schoolName.trim().toUpperCase();
  return SCHOOL_MAPPING[normalized] || '';
}

function parseGvizResponse(text: string): { cols: { label: string }[], rows: { c: { v: unknown }[] }[] } | null {
  try {
    // Remove the google.visualization.Query.setResponse() wrapper
    const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
    if (!jsonMatch) {
      console.error('Could not extract JSON from gviz response');
      return null;
    }
    
    let jsonStr = jsonMatch[1];
    // Fix date format for JSON parsing
    jsonStr = jsonStr.replace(/new Date\((\d+),(\d+),(\d+)\)/g, '"Date($1,$2,$3)"');
    
    return JSON.parse(jsonStr).table;
  } catch (e) {
    console.error('Failed to parse gviz response:', e);
    return null;
  }
}

function findColumnIndex(cols: { label: string }[], ...possibleLabels: string[]): number {
  for (const label of possibleLabels) {
    const index = cols.findIndex(col => 
      col.label?.toLowerCase().trim() === label.toLowerCase()
    );
    if (index !== -1) return index;
  }
  return -1;
}

async function fetchDespesasData(): Promise<DespesaItem[]> {
  const items: DespesaItem[] = [];
  
  try {
    const encodedSheetName = encodeURIComponent(SHEET_NAME);
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodedSheetName}`;
    
    console.log(`Fetching despesas from: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch sheet: ${response.status}`);
      return items;
    }
    
    const text = await response.text();
    const table = parseGvizResponse(text);
    
    if (!table || !table.rows) {
      console.error('No table data found');
      return items;
    }
    
    console.log(`Found ${table.rows.length} rows, columns:`, table.cols.map(c => c.label));
    
    // Find column indices
    const dataColIndex = findColumnIndex(table.cols, 'data', 'Data', 'DATA', 'Data de Vencimento');
    const escolaColIndex = findColumnIndex(table.cols, 'escola', 'Escola', 'ESCOLA');
    const descricaoColIndex = findColumnIndex(table.cols, 'descrição', 'Descrição', 'DESCRIÇÃO', 'descricao', 'Descricao');
    const valorColIndex = findColumnIndex(table.cols, 'valor', 'Valor', 'VALOR');
    
    console.log(`Column indices - Data: ${dataColIndex}, Escola: ${escolaColIndex}, Descrição: ${descricaoColIndex}, Valor: ${valorColIndex}`);
    
    if (dataColIndex === -1 || escolaColIndex === -1 || valorColIndex === -1) {
      console.error('Required columns not found');
      return items;
    }
    
    for (const row of table.rows) {
      if (!row.c) continue;
      
      const dataRaw = row.c[dataColIndex]?.v;
      const escolaRaw = row.c[escolaColIndex]?.v;
      const descricaoRaw = row.c[descricaoColIndex]?.v;
      const valorRaw = row.c[valorColIndex]?.v;
      
      const dataVencimento = normalizeDate(dataRaw);
      const escola = String(escolaRaw || '').trim();
      const escolaSlug = getSchoolSlug(escola);
      const descricao = String(descricaoRaw || '').trim();
      const valor = normalizeNumber(valorRaw);
      
      // Skip rows without essential data
      if (!escolaSlug || valor === 0) continue;
      
      // Filter only 2026+ data
      if (dataVencimento) {
        const year = parseInt(dataVencimento.substring(0, 4), 10);
        if (year < 2026) continue;
      }
      
      items.push({
        escola,
        escolaSlug,
        dataVencimento,
        descricao,
        valor,
      });
    }
    
    console.log(`Processed ${items.length} valid despesa items`);
    
  } catch (error) {
    console.error('Error fetching despesas:', error);
  }
  
  return items;
}

async function fetchReformaData(): Promise<ReformaItem[]> {
  const items: ReformaItem[] = [];
  
  try {
    const encodedSheetName = encodeURIComponent(SHEET_NAME_REFORMA);
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodedSheetName}`;
    
    console.log(`Fetching reforma from: ${url}`);
    
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch reforma sheet: ${response.status}`);
      return items;
    }
    
    const text = await response.text();
    const table = parseGvizResponse(text);
    
    if (!table || !table.rows) {
      console.error('No reforma table data found');
      return items;
    }
    
    console.log(`Found ${table.rows.length} reforma rows, columns:`, table.cols.map(c => c.label));
    
    // Find column indices - columns: DATA DE VENCIMENTO | ESCOLA | FORNECEDOR | DESCRIÇÃO | PARC | VALOR
    const dataColIndex = findColumnIndex(table.cols, 'data de vencimento', 'Data de Vencimento', 'DATA DE VENCIMENTO', 'data', 'Data');
    const escolaColIndex = findColumnIndex(table.cols, 'escola', 'Escola', 'ESCOLA');
    const descricaoColIndex = findColumnIndex(table.cols, 'descrição', 'Descrição', 'DESCRIÇÃO', 'descricao', 'Descricao');
    const valorColIndex = findColumnIndex(table.cols, 'valor', 'Valor', 'VALOR');
    
    console.log(`Reforma column indices - Data: ${dataColIndex}, Escola: ${escolaColIndex}, Descrição: ${descricaoColIndex}, Valor: ${valorColIndex}`);
    
    if (dataColIndex === -1 || escolaColIndex === -1 || valorColIndex === -1) {
      console.error('Required reforma columns not found');
      return items;
    }
    
    for (const row of table.rows) {
      if (!row.c) continue;
      
      const dataRaw = row.c[dataColIndex]?.v;
      const escolaRaw = row.c[escolaColIndex]?.v;
      const descricaoRaw = row.c[descricaoColIndex]?.v;
      const valorRaw = row.c[valorColIndex]?.v;
      
      const dataVencimento = normalizeDate(dataRaw);
      const escola = String(escolaRaw || '').trim();
      const escolaSlug = getSchoolSlug(escola);
      const descricao = String(descricaoRaw || '').trim();
      const valor = normalizeNumber(valorRaw); // normalizeNumber already returns Math.abs
      
      // Skip rows without essential data
      if (!escolaSlug || valor === 0) continue;
      
      // Filter only 2026+ data
      if (dataVencimento) {
        const year = parseInt(dataVencimento.substring(0, 4), 10);
        if (year < 2026) continue;
      }
      
      items.push({
        escola,
        escolaSlug,
        dataVencimento,
        descricao,
        valor,
      });
    }
    
    console.log(`Processed ${items.length} valid reforma items`);
    
  } catch (error) {
    console.error('Error fetching reforma:', error);
  }
  
  return items;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    console.log('Starting despesas fetch...');
    
    const [items, reformas] = await Promise.all([
      fetchDespesasData(),
      fetchReformaData(),
    ]);
    
    console.log(`Total despesas items fetched: ${items.length}, reforma items: ${reformas.length}`);
    
    return new Response(
      JSON.stringify({ items, reformas }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
    
  } catch (error) {
    console.error('Error in fetch-sheets-despesas:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ error: errorMessage, items: [], reformas: [] }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
