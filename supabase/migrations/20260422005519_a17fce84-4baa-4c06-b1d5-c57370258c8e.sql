-- Bucket privado para relatórios PDF gerados pela auditoria.
-- Usamos URLs assinadas (signed URLs) com expiração para compartilhamento seguro.
INSERT INTO storage.buckets (id, name, public)
VALUES ('audit-reports', 'audit-reports', false)
ON CONFLICT (id) DO NOTHING;

-- Apenas admins podem ler diretamente; o link público é via signed URL gerada
-- pela edge function (service role), portanto NÃO precisamos de policy pública.
CREATE POLICY "Admins can read audit reports"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'audit-reports' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can upload audit reports"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'audit-reports' AND has_role(auth.uid(), 'admin'::app_role));