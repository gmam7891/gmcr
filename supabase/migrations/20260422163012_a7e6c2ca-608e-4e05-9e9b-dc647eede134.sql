-- Enable RLS on realtime.messages (Realtime broadcast/presence/postgres_changes)
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if rerunning
DROP POLICY IF EXISTS "Admins can subscribe to all realtime topics" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated can subscribe to realtime" ON realtime.messages;

-- Only admins can subscribe to sensitive pipeline channels
CREATE POLICY "Admins can subscribe to all realtime topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Allow admins to publish (insert) realtime broadcasts
CREATE POLICY "Admins can publish realtime topics"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));