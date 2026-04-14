
-- 1. Add ai_evidence column to stream_snapshots
ALTER TABLE public.stream_snapshots ADD COLUMN IF NOT EXISTS ai_evidence text;

-- 2. Performance indexes
CREATE INDEX IF NOT EXISTS idx_raw_evidences_vod_id ON public.raw_evidences(vod_id);
CREATE INDEX IF NOT EXISTS idx_raw_evidences_streamer ON public.raw_evidences(streamer_login);
CREATE INDEX IF NOT EXISTS idx_gameplay_blocks_vod_id ON public.gameplay_blocks(vod_id);
CREATE INDEX IF NOT EXISTS idx_gameplay_blocks_streamer ON public.gameplay_blocks(streamer_login);
CREATE INDEX IF NOT EXISTS idx_gameplay_blocks_status ON public.gameplay_blocks(status);
CREATE INDEX IF NOT EXISTS idx_vod_audits_vod_id ON public.vod_audits(vod_id);
CREATE INDEX IF NOT EXISTS idx_vod_audits_streamer ON public.vod_audits(streamer_login);
CREATE INDEX IF NOT EXISTS idx_detections_streamer ON public.detections(streamer_login);
CREATE INDEX IF NOT EXISTS idx_exposure_blocks_streamer ON public.exposure_blocks(streamer_login);
CREATE INDEX IF NOT EXISTS idx_stream_snapshots_streamer ON public.stream_snapshots(streamer_login);
CREATE INDEX IF NOT EXISTS idx_stream_snapshots_captured ON public.stream_snapshots(captured_at);

-- 3. Harden RLS on monitored_streamers
DROP POLICY IF EXISTS "Allow all on monitored_streamers" ON public.monitored_streamers;
CREATE POLICY "Authenticated can read monitored_streamers" ON public.monitored_streamers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage monitored_streamers" ON public.monitored_streamers FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. Harden RLS on stream_snapshots
DROP POLICY IF EXISTS "Allow all on stream_snapshots" ON public.stream_snapshots;
CREATE POLICY "Authenticated can read stream_snapshots" ON public.stream_snapshots FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage stream_snapshots" ON public.stream_snapshots FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Tighten exposure_blocks
DROP POLICY IF EXISTS "Service can manage exposure_blocks" ON public.exposure_blocks;
CREATE POLICY "Admins can manage exposure_blocks" ON public.exposure_blocks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 6. Tighten gameplay_blocks
DROP POLICY IF EXISTS "Service can manage gameplay_blocks" ON public.gameplay_blocks;
CREATE POLICY "Admins can manage gameplay_blocks" ON public.gameplay_blocks FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 7. Tighten vod_audits
DROP POLICY IF EXISTS "Service can manage vod_audits" ON public.vod_audits;
CREATE POLICY "Admins can manage vod_audits" ON public.vod_audits FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 8. Tighten processing_queue
DROP POLICY IF EXISTS "Service can manage processing_queue" ON public.processing_queue;
CREATE POLICY "Admins can manage processing_queue" ON public.processing_queue FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 9. Tighten chat_messages insert
DROP POLICY IF EXISTS "Service can insert chat_messages" ON public.chat_messages;
CREATE POLICY "Admins can insert chat_messages" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 10. Tighten raw_evidences insert/update
DROP POLICY IF EXISTS "Service can insert raw_evidences" ON public.raw_evidences;
DROP POLICY IF EXISTS "Service can update raw_evidences" ON public.raw_evidences;
CREATE POLICY "Admins can insert raw_evidences" ON public.raw_evidences FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update raw_evidences" ON public.raw_evidences FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 11. Tighten detections insert
DROP POLICY IF EXISTS "Service can insert detections" ON public.detections;
CREATE POLICY "Admins can insert detections" ON public.detections FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
