-- Trust level system for withdrawals
-- Levels: 'new' (0-3 withdrawals), 'trusted' (4-15), 'veteran' (16+)
-- Each level unlocks faster/more convenient withdrawal flows

-- Create withdrawal_trust table
CREATE TABLE IF NOT EXISTS withdrawal_trust (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trust_level text NOT NULL DEFAULT 'new' CHECK (trust_level IN ('new', 'trusted', 'veteran')),
  total_withdrawals integer NOT NULL DEFAULT 0,
  total_amount integer NOT NULL DEFAULT 0, -- in CareCoins
  last_withdrawal_at timestamptz,
  consecutive_success integer NOT NULL DEFAULT 0,
  failed_attempts_total integer NOT NULL DEFAULT 0,
  device_trust_enabled boolean NOT NULL DEFAULT false,
  biometric_enabled boolean NOT NULL DEFAULT false,
  instant_threshold integer NOT NULL DEFAULT 0, -- max coins for instant withdrawal (0 = not eligible)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE withdrawal_trust ENABLE ROW LEVEL SECURITY;

-- Withdrawal history log for trust calculation
CREATE TABLE IF NOT EXISTS withdrawal_history_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  withdrawal_request_id uuid,
  amount integer NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'failed', 'cancelled')),
  pin_used boolean NOT NULL DEFAULT true,
  biometric_used boolean NOT NULL DEFAULT false,
  device_id text,
  processing_time_ms integer, -- how long the withdrawal took
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE withdrawal_history_log ENABLE ROW LEVEL SECURITY;

-- RPC to calculate and update trust level after a withdrawal
CREATE OR REPLACE FUNCTION update_withdrawal_trust_after_withdrawal(
  p_user_id uuid,
  p_amount integer,
  p_status text
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_trust withdrawal_trust%ROWTYPE;
  v_new_level text;
  v_new_threshold integer;
BEGIN
  -- Upsert the trust record
  INSERT INTO withdrawal_trust (user_id, total_withdrawals, total_amount, last_withdrawal_at, consecutive_success)
  VALUES (p_user_id, 1, p_amount, now(), 1)
  ON CONFLICT (user_id) DO UPDATE SET
    total_withdrawals = withdrawal_trust.total_withdrawals + 1,
    total_amount = withdrawal_trust.total_amount + p_amount,
    last_withdrawal_at = now(),
    consecutive_success = CASE 
      WHEN p_status = 'completed' THEN withdrawal_trust.consecutive_success + 1
      ELSE 0
    END,
    updated_at = now()
  RETURNING * INTO v_trust;

  -- Calculate new trust level
  IF v_trust.total_withdrawals >= 16 AND v_trust.consecutive_success >= 5 THEN
    v_new_level := 'veteran';
    v_new_threshold := 50; -- 50 CareCoins instant threshold
  ELSIF v_trust.total_withdrawals >= 4 AND v_trust.consecutive_success >= 3 THEN
    v_new_level := 'trusted';
    v_new_threshold := 20; -- 20 CareCoins instant threshold
  ELSE
    v_new_level := 'new';
    v_new_threshold := 0;
  END IF;

  -- Update level and threshold if changed
  IF v_new_level != v_trust.trust_level OR v_new_threshold != v_trust.instant_threshold THEN
    UPDATE withdrawal_trust SET
      trust_level = v_new_level,
      instant_threshold = v_new_threshold,
      updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  -- Log the history
  INSERT INTO withdrawal_history_log (user_id, amount, status)
  VALUES (p_user_id, p_amount, p_status);

  RETURN v_new_level;
END;
$$;

-- RPC to get trust info for a user
CREATE OR REPLACE FUNCTION get_withdrawal_trust(p_user_id uuid)
RETURNS TABLE (
  trust_level text,
  total_withdrawals integer,
  total_amount integer,
  instant_threshold integer,
  device_trust_enabled boolean,
  biometric_enabled boolean,
  consecutive_success integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT wt.trust_level, wt.total_withdrawals, wt.total_amount, 
         wt.instant_threshold, wt.device_trust_enabled, wt.biometric_enabled,
         wt.consecutive_success
  FROM withdrawal_trust wt
  WHERE wt.user_id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'new'::text, 0, 0, 0, false, false, 0;
  END IF;
END;
$$;

-- RPC to enable device trust (after biometric verification)
CREATE OR REPLACE FUNCTION enable_device_trust(p_user_id uuid, p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_level text;
BEGIN
  SELECT trust_level INTO v_level FROM withdrawal_trust WHERE user_id = p_user_id;
  
  -- Only trusted+ users can enable device trust
  IF v_level IS NULL OR v_level = 'new' THEN
    RETURN false;
  END IF;
  
  UPDATE withdrawal_trust SET device_trust_enabled = true, updated_at = now()
  WHERE user_id = p_user_id;
  
  RETURN true;
END;
$$;

-- Grants
REVOKE EXECUTE ON FUNCTION update_withdrawal_trust_after_withdrawal FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_withdrawal_trust_after_withdrawal TO authenticated;

REVOKE EXECUTE ON FUNCTION get_withdrawal_trust FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_withdrawal_trust TO authenticated;

REVOKE EXECUTE ON FUNCTION enable_device_trust FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION enable_device_trust TO authenticated;

-- RLS policies
CREATE POLICY "withdrawal_trust own" ON withdrawal_trust
  FOR ALL TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "withdrawal_history_log own" ON withdrawal_history_log
  FOR ALL TO authenticated
  USING (user_id = auth.uid());
