/**
 * Extrai número de ordenação de uma string de categoria
 * Ex: "4.23 Custo com Sistema" -> 4.23
 * Ex: "1. Receita Bruta" -> 1.0
 */
export function extractOrderNumber(text: string): number {
  const match = text.match(/^(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : Infinity;
}

/**
 * Normaliza descrição para matching fuzzy
 * - Remove aspas simples e duplas
 * - Remove prefixos de parcela (1/3 -, 2/5 -, etc)
 * - Remove espaços múltiplos
 * - Converte para minúsculas
 * - Remove pontuação extra
 */
export function normalizeDescription(text: string): string {
  return text
    .toLowerCase()
    .replace(/^["']|["']$/g, '') // Remove aspas no início e fim
    .replace(/[""'']/g, '') // Remove todas as aspas
    .replace(/^\d+\/\d+\s*-\s*/g, '') // Remove prefixo de parcela (1/3 -, 2/5 -, etc)
    .replace(/\s+/g, ' ') // Normaliza espaços
    .replace(/[:\-,;]/g, ' ') // Substitui pontuação por espaço
    .replace(/\s+/g, ' ') // Normaliza espaços novamente
    .trim();
}

/**
 * Calcula similaridade entre duas strings usando distância de Levenshtein
 * Retorna valor entre 0 e 1 (1 = idênticas, 0 = completamente diferentes)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 1;
  
  const len1 = s1.length;
  const len2 = s2.length;
  
  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;
  
  // Matriz de distância de Levenshtein
  const matrix: number[][] = [];
  
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  
  return 1 - (distance / maxLen);
}

/**
 * Encontra o melhor match para uma descrição usando 3 camadas:
 * 1. Match exato normalizado (mais rápido)
 * 2. Match parcial (contém)
 * 3. Similaridade >= 90% (mais lento, mas abrangente)
 */
export function findBestMatch(
  description: string,
  mappings: Array<{ descricao: string; [key: string]: any }>
): { mapping: any; matchType: string; similarity: number } | null {
  const normalized = normalizeDescription(description);
  
  // Camada 1: Match exato normalizado
  for (const mapping of mappings) {
    const mappingNormalized = normalizeDescription(mapping.descricao);
    if (normalized === mappingNormalized) {
      return { mapping, matchType: 'exact', similarity: 1.0 };
    }
  }
  
  // Camada 2: Match parcial (contém)
  for (const mapping of mappings) {
    const mappingNormalized = normalizeDescription(mapping.descricao);
    if (normalized.includes(mappingNormalized) || mappingNormalized.includes(normalized)) {
      const similarity = calculateSimilarity(normalized, mappingNormalized);
      if (similarity >= 0.7) { // Contém mas precisa ter pelo menos 70% de similaridade
        return { mapping, matchType: 'partial', similarity };
      }
    }
  }
  
  // Camada 3: Similaridade >= 90%
  let bestMatch: { mapping: any; similarity: number } | null = null;
  
  for (const mapping of mappings) {
    const mappingNormalized = normalizeDescription(mapping.descricao);
    const similarity = calculateSimilarity(normalized, mappingNormalized);
    
    if (similarity >= 0.9) {
      if (!bestMatch || similarity > bestMatch.similarity) {
        bestMatch = { mapping, similarity };
      }
    }
  }
  
  if (bestMatch) {
    return { mapping: bestMatch.mapping, matchType: 'fuzzy', similarity: bestMatch.similarity };
  }
  
  return null;
}
