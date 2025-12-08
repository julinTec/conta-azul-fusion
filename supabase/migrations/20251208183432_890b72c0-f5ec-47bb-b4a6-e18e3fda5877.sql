-- Primeiro, deletar registros duplicados mantendo apenas o mais recente por school_id
DELETE FROM conta_azul_config
WHERE id NOT IN (
  SELECT DISTINCT ON (school_id) id
  FROM conta_azul_config
  WHERE school_id IS NOT NULL
  ORDER BY school_id, updated_at DESC
);

-- Adicionar constraint UNIQUE em school_id para prevenir duplicações futuras
ALTER TABLE conta_azul_config
ADD CONSTRAINT conta_azul_config_school_id_unique UNIQUE (school_id);