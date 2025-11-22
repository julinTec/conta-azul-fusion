import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSchool } from "@/contexts/SchoolContext";
import * as XLSX from "xlsx";

interface CSVRow {
  descricao: string;
  categoria: string;
  nivel_1: string;
  nivel_2: string;
}

export const DFCUploadCSV = () => {
  const { school } = useSchool();
  const [uploading, setUploading] = useState(false);
  const [fileInfo, setFileInfo] = useState<{ name: string; rows: number } | null>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !school?.id) return;

    setUploading(true);
    try {
      // Ler o arquivo
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      // Mapear colunas (assumindo que são E, H, I, J conforme especificado)
      const mappings: CSVRow[] = [];

      jsonData.forEach((row: any) => {
        // Ajustar conforme estrutura real do CSV
        // IMPORTANTE: Colunas I e J foram corrigidas (estavam invertidas)
        const descricao = row['Descrição'] || row['E'] || row[Object.keys(row)[4]];
        const categoria = row['Categoria'] || row['H'] || row[Object.keys(row)[7]];
        const nivel_2 = row['Nível 2'] || row['I'] || row[Object.keys(row)[8]]; // Coluna I = Nível 2
        const nivel_1 = row['Nível 1'] || row['J'] || row[Object.keys(row)[9]]; // Coluna J = Nível 1

        if (descricao && nivel_1 && nivel_2) {
          mappings.push({
            descricao: String(descricao).trim(),
            categoria: categoria ? String(categoria).trim() : null,
            nivel_1: String(nivel_1).trim(),
            nivel_2: String(nivel_2).trim()
          });
        }
      });

      if (mappings.length === 0) {
        toast.error('Nenhum mapeamento válido encontrado no arquivo');
        return;
      }

      // Limpar mapeamentos antigos desta escola
      const { error: deleteError } = await supabase
        .from('dfc_mapping')
        .delete()
        .eq('school_id', school.id);

      if (deleteError) throw deleteError;

      // Inserir novos mapeamentos em lotes
      const batchSize = 500;
      let inserted = 0;

      for (let i = 0; i < mappings.length; i += batchSize) {
        const batch = mappings.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from('dfc_mapping')
          .insert(
            batch.map(m => ({
              school_id: school.id,
              descricao: m.descricao,
              categoria: m.categoria,
              nivel_1: m.nivel_1,
              nivel_2: m.nivel_2
            }))
          );

        if (insertError) throw insertError;
        inserted += batch.length;
      }

      // Validação visual e preview
      const hasOrderNumbers = mappings.some(m => /^\d+/.test(m.nivel_1) && /^\d+/.test(m.nivel_2));
      if (!hasOrderNumbers) {
        toast.error('Aviso: Nenhum número de ordenação detectado nos níveis!');
      }
      
      console.log('Preview dos primeiros 3 mapeamentos importados:', mappings.slice(0, 3));

      setFileInfo({ name: file.name, rows: inserted });
      toast.success(`${inserted} mapeamentos importados com sucesso!`);
    } catch (error: any) {
      console.error('Error uploading Excel:', error);
      toast.error('Erro ao importar arquivo: ' + error.message);
    } finally {
      setUploading(false);
      // Limpar input
      event.target.value = '';
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Upload de Mapeamento DFC
        </CardTitle>
        <CardDescription>
          Faça upload do arquivo Excel com o mapeamento DE-PARA das descrições
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-2 border-dashed border-muted-foreground/20 rounded-lg p-6 text-center">
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
            id="csv-upload"
          />
          <label htmlFor="csv-upload" className="cursor-pointer">
            <div className="flex flex-col items-center gap-3">
              <Upload className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">
                  {uploading ? 'Processando...' : 'Clique para selecionar arquivo'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Arquivo Excel (XLSX/XLS) com as colunas especificadas abaixo
                </p>
              </div>
            </div>
          </label>
        </div>

        {fileInfo && (
          <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
            <div>
              <p className="font-medium text-green-800 dark:text-green-200">
                Importação Concluída
              </p>
              <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                {fileInfo.rows} mapeamentos de "{fileInfo.name}"
              </p>
            </div>
          </div>
        )}

        <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
          <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-blue-800 dark:text-blue-200">
              Formato esperado
            </p>
            <ul className="list-disc list-inside text-blue-700 dark:text-blue-300 mt-2 space-y-1">
              <li>Coluna E: Descrição (texto exato do lançamento)</li>
              <li>Coluna H: Categoria (opcional)</li>
              <li>Coluna I: Nível 2 (ex: 1.1 Receita com Mensalidade)</li>
              <li>Coluna J: Nível 1 (ex: 1. Receita Bruta)</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};