-- Shop promo codes / discount codes
-- Allows customers to apply discount codes at checkout

CREATE TABLE IF NOT EXISTS shop_promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  description text,
  discount_type text NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value integer NOT NULL CHECK (discount_value > 0), -- percentage (1-100) or fixed amount in kobo
  min_order_kobo integer DEFAULT 0, -- minimum order value to apply
  max_discount_kobo integer, -- maximum discount amount (for percentage type)
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  usage_limit integer, -- total usage limit
  usage_limit_per_user integer DEFAULT 1, -- per-user usage limit
  used_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  applicable_segments text[], -- NULL means all segments
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_promo_codes_code ON shop_promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_shop_promo_codes_active ON shop_promo_codes(is_active) WHERE is_active = true;

-- Track promo code usage per user
CREATE TABLE IF NOT EXISTS shop_promo_code_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL REFERENCES shop_promo_codes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  discount_kobo integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(promo_code_id, user_id, order_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_promo_code_usage_user ON shop_promo_code_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_promo_code_usage_promo ON shop_promo_code_usage(promo_code_id);

-- Enable RLS
ALTER TABLE shop_promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_promo_code_usage ENABLE ROW LEVEL SECURITY;

-- RLS policies for promo codes (public read for active codes)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_promo_codes_select' AND tablename = 'shop_promo_codes') THEN
    CREATE POLICY "shop_promo_codes_select" ON shop_promo_codes
    FOR SELECT TO authenticated
    USING (is_active = true AND (valid_until IS NULL OR valid_until > now()));
  END IF;
END $$;

-- RLS policies for usage tracking (users can only see their own usage)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_promo_code_usage_select' AND tablename = 'shop_promo_code_usage') THEN
    CREATE POLICY "shop_promo_code_usage_select" ON shop_promo_code_usage
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'shop_promo_code_usage_insert' AND tablename = 'shop_promo_code_usage') THEN
    CREATE POLICY "shop_promo_code_usage_insert" ON shop_promo_code_usage
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Function to validate and apply promo code
CREATE OR REPLACE FUNCTION public.validate_promo_code(
  p_code text,
  p_user_id uuid,
  p_order_kobo integer,
  p_segment text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_promo record;
  v_user_usage_count integer;
  v_discount_kobo integer;
BEGIN
  -- Find the promo code
  SELECT * INTO v_promo
  FROM shop_promo_codes
  WHERE code = UPPER(p_code)
    AND is_active = true
    AND valid_from <= now()
    AND (valid_until IS NULL OR valid_until > now());

  IF v_promo IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid or expired promo code');
  END IF;

  -- Check minimum order value
  IF p_order_kobo < v_promo.min_order_kobo THEN
    RETURN jsonb_build_object('valid', false, 'error', 
      format('Minimum order value of ₦%s required', (v_promo.min_order_kobo / 100)::text));
  END IF;

  -- Check segment applicability
  IF v_promo.applicable_segments IS NOT NULL AND p_segment IS NOT NULL THEN
    IF NOT (p_segment = ANY(v_promo.applicable_segments)) THEN
      RETURN jsonb_build_object('valid', false, 'error', 'This promo code is not valid for this segment');
    END IF;
  END IF;

  -- Check total usage limit
  IF v_promo.usage_limit IS NOT NULL AND v_promo.used_count >= v_promo.usage_limit THEN
    RETURN jsonb_build_object('valid', false, 'error', 'This promo code has reached its usage limit');
  END IF;

  -- Check per-user usage limit
  SELECT COUNT(*) INTO v_user_usage_count
  FROM shop_promo_code_usage
  WHERE promo_code_id = v_promo.id AND user_id = p_user_id;

  IF v_promo.usage_limit_per_user IS NOT NULL AND v_user_usage_count >= v_promo.usage_limit_per_user THEN
    RETURN jsonb_build_object('valid', false, 'error', 'You have already used this promo code');
  END IF;

  -- Calculate discount
  IF v_promo.discount_type = 'percentage' THEN
    v_discount_kobo := (p_order_kobo * v_promo.discount_value) / 100;
    -- Apply max discount cap if set
    IF v_promo.max_discount_kobo IS NOT NULL AND v_discount_kobo > v_promo.max_discount_kobo THEN
      v_discount_kobo := v_promo.max_discount_kobo;
    END IF;
  ELSE
    v_discount_kobo := v_promo.discount_value;
  END IF;

  -- Ensure discount doesn't exceed order total
  IF v_discount_kobo > p_order_kobo THEN
    v_discount_kobo := p_order_kobo;
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'promo_code_id', v_promo.id,
    'discount_type', v_promo.discount_type,
    'discount_value', v_promo.discount_value,
    'discount_kobo', v_discount_kobo,
    'description', v_promo.description
  );
END;
$$;

-- Function to apply promo code to order (called after order creation)
CREATE OR REPLACE FUNCTION public.apply_promo_code_to_order(
  p_order_id uuid,
  p_promo_code_id uuid,
  p_discount_kobo integer
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Get order's customer_id
  SELECT customer_id INTO v_user_id FROM shop_orders WHERE id = p_order_id;

  -- Record usage
  INSERT INTO shop_promo_code_usage (promo_code_id, user_id, order_id, discount_kobo)
  VALUES (p_promo_code_id, v_user_id, p_order_id, p_discount_kobo);

  -- Increment usage count
  UPDATE shop_promo_codes
  SET used_count = used_count + 1, updated_at = now()
  WHERE id = p_promo_code_id;

  -- Update order total
  UPDATE shop_orders
  SET total_kobo = GREATEST(0, total_kobo - p_discount_kobo),
      updated_at = now()
  WHERE id = p_order_id;
END;
$$;

-- Grant permissions
REVOKE ALL ON FUNCTION public.validate_promo_code(text, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_promo_code(text, uuid, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_promo_code_to_order(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_promo_code_to_order(uuid, uuid, integer) TO authenticated;

-- Add promo_code_id and discount_kobo columns to shop_orders
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS promo_code_id uuid REFERENCES shop_promo_codes(id);
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS discount_kobo integer DEFAULT 0;
