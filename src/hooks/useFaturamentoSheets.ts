import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FaturamentoData } from "@/types/faturamento";

export function useFaturamentoSheets() {
  return useQuery({
    queryKey: ["faturamento-sheets"],
    queryFn: async (): Promise<FaturamentoData> => {
      const { data, error } = await supabase.functions.invoke("fetch-sheets-faturamento");
      
      if (error) {
        console.error("Error fetching faturamento data:", error);
        throw error;
      }
      
      return data as FaturamentoData;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });
}
