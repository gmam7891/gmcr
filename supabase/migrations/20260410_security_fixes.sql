-- Habilitar RLS para a tabela realtime.messages
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Remover políticas existentes para evitar conflitos
DROP POLICY IF EXISTS "Realtime: Allow authenticated users to subscribe to their own topics" ON realtime.messages;

-- Política para permitir que usuários autenticados se inscrevam apenas em tópicos relevantes para eles
-- Exemplo: Tópicos que incluem o ID do usuário ou que são públicos por design.
-- Para tópicos internos como 'detections' e 'processing_queue', a subscrição deve ser restrita.
-- Esta política permite a leitura de mensagens onde o tópico não é um tópico interno sensível.
CREATE POLICY "Realtime: Restrict subscription to sensitive topics" ON realtime.messages
  FOR SELECT USING (
    -- Permite acesso a tópicos que não são internos/sensíveis
    NOT (topic LIKE 'pg:realtime:detections' OR topic LIKE 'pg:realtime:processing_queue')
    -- OU, se for um tópico sensível, o usuário deve ser um administrador ou ter permissão específica
    -- (Esta parte precisaria de uma lógica mais complexa baseada em roles ou claims JWT, se aplicável)
    -- Por simplicidade, inicialmente, bloqueamos o acesso a esses tópicos para usuários comuns.
  );

-- Nota: Para gerenciar o acesso a tópicos como 'detections' e 'processing_queue',
-- você precisaria de uma lógica mais granular, possivelmente verificando claims JWT
-- (ex: auth.jwt() ->> 'user_role' = 'admin') ou se o tópico inclui o auth.uid().
-- A política acima bloqueia o acesso geral a esses tópicos sensíveis para usuários comuns.
