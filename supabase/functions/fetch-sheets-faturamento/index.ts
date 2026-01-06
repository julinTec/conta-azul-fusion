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

function parseCSV(csvText: string): string[][] {
  const lines = csvText.split('\n');
  return lines.map(line => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  });
}

function parseNumber(value: string): number {
  if (!value) return 0;
  // Remove R$, spaces, and handle Brazilian number format
  const cleaned = value
    .replace(/R\$\s*/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')  // Remove thousand separators
    .replace(',', '.');   // Convert decimal separator
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function excelSerialToDate(serial: number): string {
  // Excel/Google Sheets: days since 30/12/1899
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 24 * 60 * 60 * 1000);
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

function parseDate(dateStr: string): string {
  if (!dateStr) return '';
  
  const trimmed = dateStr.trim();
  
  // If it's an Excel serial number (only digits, optionally with decimal)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const serial = parseFloat(trimmed);
    if (serial > 0 && serial < 100000) {
      return excelSerialToDate(serial);
    }
  }
  
  // If already in YYYY-MM-DD format, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  
  // Try to parse dd/mm/yyyy format
  const parts = trimmed.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return dateStr;
}

async function fetchSchoolData(schoolSlug: string, schoolName: string): Promise<FaturamentoItem[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(schoolSlug)}`;
  
  console.log(`Fetching data for ${schoolName} from tab: ${schoolSlug}`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch ${schoolSlug}: ${response.status}`);
      return [];
    }
    
    const csvText = await response.text();
    const rows = parseCSV(csvText);
    
    if (rows.length < 2) {
      console.log(`No data found for ${schoolSlug}`);
      return [];
    }
    
    // Skip header row
    const dataRows = rows.slice(1).filter(row => row.some(cell => cell.trim() !== ''));
    
    console.log(`Found ${dataRows.length} rows for ${schoolSlug}`);
    
    return dataRows.map(row => ({
      escola: schoolName,
      escolaSlug: schoolSlug,
      nomeAluno: row[0] || '',
      nomeResponsavel: row[1] || '',
      dataVencimento: parseDate(row[2] || ''),
      valorBruto: parseNumber(row[3] || '0'),
      desconto: row[4] || '',
      valor: parseNumber(row[5] || '0'),
      serie: row[6] || '',
      status: row[7] || '',
    }));
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
    
    // Fetch data from all schools in parallel
    const allDataPromises = SCHOOLS.map(school => 
      fetchSchoolData(school.slug, school.name)
    );
    
    const allResults = await Promise.all(allDataPromises);
    const allItems = allResults.flat();
    
    console.log(`Total items fetched: ${allItems.length}`);
    
    // Calculate summary per school
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
