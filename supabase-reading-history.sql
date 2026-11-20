-- ============================================================
-- QURAN VOCABULARY APP: READING & LISTENING HISTORY MIGRATION
-- Open a NEW empty tab in Supabase Dashboard -> SQL Editor,
-- paste this entire script, and click Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_reading_history (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  surah INTEGER NOT NULL CHECK (surah >= 1 AND surah <= 114),
  read_word_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  listen_word_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  read_count INTEGER NOT NULL DEFAULT 0,
  listen_count INTEGER NOT NULL DEFAULT 0,
  surah_listen_count INTEGER NOT NULL DEFAULT 0,
  read_seconds INTEGER NOT NULL DEFAULT 0,
  listen_seconds INTEGER NOT NULL DEFAULT 0,
  total_seconds INTEGER NOT NULL DEFAULT 0,
  last_ayah INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, activity_date, surah)
);

CREATE INDEX IF NOT EXISTS idx_reading_history_user_date
  ON public.user_reading_history (user_id, activity_date DESC);

ALTER TABLE public.user_reading_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own reading history" ON public.user_reading_history;
CREATE POLICY "Users can manage own reading history"
  ON public.user_reading_history
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
