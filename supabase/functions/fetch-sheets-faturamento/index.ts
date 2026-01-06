import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPREADSHEET_ID = '1sJ4Vz8LYG5K3x9kiicqic9YJRxGFNnw6Qp2RuEbilr0';
const SCHOOLS = [
  { slug: 'paulo-freire', name: 'Colégio Paulo Freire' },
  { slug: 'renascer', name: 'Colégio Renascer' },
  { slug: 'conectivo', name: 'Colégio Conectivo' },
  { slug: 'aventurando', name: 'Colégio Aventurando' },
];

interface FaturamentoItem {
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
  
  // If it's a gviz Date object like "Date(2026,1,15)" - month is 0-indexed
  if (typeof value === 'string' && value.startsWith('Date(')) {
    const match = value.match(/Date\((\d+),(\d+),(\d+)\)/);
    if (match) {
      const year = match[1];
      const month = String(parseInt(match[2]) + 1).padStart(2, '0'); // 0-indexed
      const day = match[3].padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }
  
  const strValue = String(value).trim();
  
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(strValue)) {
    return strValue;
  }
  
  // dd/MM/yyyy format
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(strValue)) {
    const parts = strValue.split('/');
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  
  // Excel serial number (numeric)
  const numValue = parseFloat(strValue.replace(',', '.'));
  if (!isNaN(numValue) && numValue > 40000 && numValue < 60000) {
    return excelSerialToDate(numValue);
  }
  
  return '';
}

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  
  const strValue = String(value)
    .replace(/R\$\s*/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')  // Remove thousand separators
    .replace(',', '.');   // Convert decimal separator
  
  const num = parseFloat(strValue);
  return isNaN(num) ? 0 : num;
}

function parseGvizResponse(text: string): { cols: { label: string }[]; rows: { c: ({ v: unknown } | null)[] }[] } | null {
  // gviz returns: google.visualization.Query.setResponse({...})
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?$/);
  if (!match) {
    console.error('Failed to match gviz response pattern');
    return null;
  }
  
  try {
    // Fix Date objects in JSON - they come as Date(YYYY,M,D)
    const jsonStr = match[1].replace(/new Date\(([^)]+)\)/g, '"Date($1)"');
    return JSON.parse(jsonStr).table;
  } catch (e) {
    console.error('Failed to parse gviz JSON:', e);
    return null;
  }
}

function findColumnIndex(cols: { label: string }[], ...possibleLabels: string[]): number {
  for (const label of possibleLabels) {
    const idx = cols.findIndex(c => 
      c.label?.toLowerCase().trim() === label.toLowerCase().trim()
    );
    if (idx !== -1) return idx;
  }
  return -1;
}

async function fetchSchoolData(schoolSlug: string, schoolName: string): Promise<FaturamentoItem[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(schoolSlug)}`;
  
  console.log(`Fetching data for ${schoolName} from tab: ${schoolSlug}`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch ${schoolSlug}: ${response.status}`);
      return [];
    }
    
    const text = await response.text();
    const table = parseGvizResponse(text);
    
    if (!table || !table.cols || !table.rows) {
      console.error(`No valid table data for ${schoolSlug}`);
      return [];
    }
    
    // Find column indices by label
    const cols = table.cols;
    console.log(`Columns for ${schoolSlug}:`, cols.map(c => c.label).join(', '));
    
    const colNomeAluno = findColumnIndex(cols, 'Nome do Aluno', 'Aluno', 'Nome');
    const colNomeResponsavel = findColumnIndex(cols, 'Nome do Responsável', 'Responsável', 'Nome Responsável');
    const colDataVencimento = findColumnIndex(cols, 'Data de vencimento', 'Data Vencimento', 'Vencimento');
    const colValor = findColumnIndex(cols, 'Valor');
    const colValorBruto = findColumnIndex(cols, 'Valor Bruto', 'Valor bruto');
    const colDesconto = findColumnIndex(cols, 'Desconto');
    const colSerie = findColumnIndex(cols, 'Série', 'Serie');
    const colStatus = findColumnIndex(cols, 'Status');
    
    console.log(`Column indices for ${schoolSlug}: aluno=${colNomeAluno}, resp=${colNomeResponsavel}, data=${colDataVencimento}, valor=${colValor}, status=${colStatus}`);
    
    const items: FaturamentoItem[] = [];
    let invalidDates = 0;
    
    for (const row of table.rows) {
      if (!row.c) continue;
      
      const getValue = (idx: number): unknown => {
        if (idx === -1 || !row.c[idx]) return null;
        // gviz can have 'v' (value) and 'f' (formatted)
        return row.c[idx]?.v ?? null;
      };
      
      const nomeAluno = String(getValue(colNomeAluno) || '').trim();
      if (!nomeAluno) continue; // Skip empty rows
      
      const rawDate = getValue(colDataVencimento);
      const dataVencimento = normalizeDate(rawDate);
      
      if (!dataVencimento || !/^\d{4}-\d{2}-\d{2}$/.test(dataVencimento)) {
        invalidDates++;
        continue; // Skip rows with invalid dates
      }
      
      // Validate year is reasonable (2020-2030)
      const year = parseInt(dataVencimento.substring(0, 4));
      if (year < 2020 || year > 2030) {
        invalidDates++;
        continue;
      }
      
      items.push({
        escola: schoolName,
        escolaSlug: schoolSlug,
        nomeAluno,
        nomeResponsavel: String(getValue(colNomeResponsavel) || '').trim(),
        dataVencimento,
        valorBruto: normalizeNumber(getValue(colValorBruto)),
        desconto: String(getValue(colDesconto) || '').trim(),
        valor: normalizeNumber(getValue(colValor)),
        serie: String(getValue(colSerie) || '').trim(),
        status: String(getValue(colStatus) || '').trim(),
      });
    }
    
    console.log(`${schoolSlug}: ${items.length} valid items, ${invalidDates} skipped (invalid dates)`);
    
    return items;
  } catch (error) {
    console.error(`Error fetching ${schoolSlug}:`, error);
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Fetching faturamento data from all schools...');
    
    const allDataPromises = SCHOOLS.map(school => 
      fetchSchoolData(school.slug, school.name)
    );
    
    const allResults = await Promise.all(allDataPromises);
    const allItems = allResults.flat();
    
    console.log(`Total items fetched: ${allItems.length}`);
    
    // Log sample dates for debugging
    const sampleDates = allItems.slice(0, 5).map(i => i.dataVencimento);
    console.log('Sample dates:', sampleDates);
    
    const resumos = SCHOOLS.map(school => {
      const schoolItems = allItems.filter(item => item.escolaSlug === school.slug);
      const uniqueStudents = new Set(schoolItems.map(item => item.nomeAluno)).size;
      const totalFaturamento = schoolItems.reduce((sum, item) => sum + item.valor, 0);
      const totalBoletos = schoolItems.length;
      
      return {
        escola: school.name,
        escolaSlug: school.slug,
        totalFaturamento,
        totalAlunos: uniqueStudents,
        totalBoletos,
        ticketMedio: totalBoletos > 0 ? totalFaturamento / totalBoletos : 0,
      };
    });

    return new Response(
      JSON.stringify({ items: allItems, resumos }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  } catch (error) {
    console.error('Error in fetch-sheets-faturamento:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
