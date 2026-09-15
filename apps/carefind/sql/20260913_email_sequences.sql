-- Email sequence progress tracking
CREATE TABLE IF NOT EXISTS email_sequence_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sequence_type text NOT NULL,
  current_step integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  completed boolean NOT NULL DEFAULT false,
  cancelled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, sequence_type)
);

-- Enable RLS
ALTER TABLE email_sequence_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own sequence progress"
  ON email_sequence_progress FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all sequences"
  ON email_sequence_progress FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_sequence_user ON email_sequence_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_email_sequence_type ON email_sequence_progress(sequence_type);
CREATE INDEX IF NOT EXISTS idx_email_sequence_pending ON email_sequence_progress(completed, last_sent_at)
  WHERE completed = false;

-- Function to clean up old completed sequences (older than 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_sequences()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM email_sequence_progress
  WHERE completed = true
  AND started_at < now() - interval '90 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Grant execute to service role only
GRANT EXECUTE ON FUNCTION cleanup_old_sequences() TO service_role;
