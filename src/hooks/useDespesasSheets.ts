import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { DespesasData } from "@/types/faturamento";

export function useDespesasSheets() {
  return useQuery({
    queryKey: ["despesas-sheets"],
    queryFn: async (): Promise<DespesasData> => {
      const { data, error } = await supabase.functions.invoke("fetch-sheets-despesas");
      
      if (error) {
        console.error("Error fetching despesas:", error);
        throw error;
      }
      
      return data as DespesasData;
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
