-- Migration: Shop orders, order items, status history, and messages
-- Creates the order management system for Shop checkout

-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment', 'paid', 'accepted', 'processing', 
    'ready_for_pickup', 'delivered', 'cancelled'
  )),
  total_kobo INTEGER NOT NULL CHECK (total_kobo >= 0),
  commission_kobo INTEGER NOT NULL CHECK (commission_kobo >= 0),
  fulfilment_kobo INTEGER NOT NULL CHECK (fulfilment_kobo >= 0),
  delivery_kobo INTEGER NOT NULL CHECK (delivery_kobo >= 0),
  delivery_address TEXT NOT NULL,
  delivery_preference TEXT NOT NULL CHECK (delivery_preference IN ('pickup', 'home')),
  payment_reference TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Order items table
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ecommerce_product_id UUID NOT NULL REFERENCES ecommerce_products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_kobo INTEGER NOT NULL CHECK (unit_price_kobo >= 0)
);

-- Order status history table
CREATE TABLE order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Order messages table (communication between customer and vendor)
CREATE TABLE order_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_vendor_id ON orders(vendor_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_payment_reference ON orders(payment_reference);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX idx_order_messages_order_id ON order_messages(order_id);

-- Row Level Security (RLS)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_messages ENABLE ROW LEVEL SECURITY;

-- Orders RLS policies
CREATE POLICY "Customers can view their own orders"
  ON orders FOR SELECT
  USING (customer_id = auth.uid());

CREATE POLICY "Vendors can view their own orders"
  ON orders FOR SELECT
  USING (vendor_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

CREATE POLICY "Customers can create their own orders"
  ON orders FOR INSERT
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Vendors can update their own orders"
  ON orders FOR UPDATE
  USING (vendor_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- Order items RLS policies
CREATE POLICY "Users can view order items for their orders"
  ON order_items FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM orders 
      WHERE customer_id = auth.uid() 
         OR vendor_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "System can create order items"
  ON order_items FOR INSERT
  WITH CHECK (true); -- Only created by atomic RPC

-- Order status history RLS policies
CREATE POLICY "Users can view status history for their orders"
  ON order_status_history FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM orders 
      WHERE customer_id = auth.uid() 
         OR vendor_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "System can create status history"
  ON order_status_history FOR INSERT
  WITH CHECK (true); -- Only created by atomic RPC

-- Order messages RLS policies
CREATE POLICY "Users can view messages for their orders"
  ON order_messages FOR SELECT
  USING (
    order_id IN (
      SELECT id FROM orders 
      WHERE customer_id = auth.uid() 
         OR vendor_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
    )
  );

CREATE POLICY "Users can send messages for their orders"
  ON order_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND order_id IN (
      SELECT id FROM orders 
      WHERE customer_id = auth.uid() 
         OR vendor_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
    )
  );

-- Atomic function to create order with inventory decrement
CREATE OR REPLACE FUNCTION create_order_with_inventory_decrement(
  p_customer_id UUID,
  p_vendor_id UUID,
  p_items JSONB, -- Array of {ecommerce_product_id, quantity, product_name, unit_price_kobo}
  p_total_kobo INTEGER,
  p_commission_kobo INTEGER,
  p_fulfilment_kobo INTEGER,
  p_delivery_kobo INTEGER,
  p_delivery_address TEXT,
  p_delivery_preference TEXT,
  p_payment_reference TEXT
) RETURNS UUID AS $$
DECLARE
  v_order_id UUID;
  v_item JSONB;
  v_stock INTEGER;
BEGIN
  -- Create the order
  INSERT INTO orders (
    customer_id, vendor_id, status, total_kobo, commission_kobo, 
    fulfilment_kobo, delivery_kobo, delivery_address, delivery_preference, 
    payment_reference
  ) VALUES (
    p_customer_id, p_vendor_id, 'pending_payment', p_total_kobo, p_commission_kobo,
    p_fulfilment_kobo, p_delivery_kobo, p_delivery_address, p_delivery_preference,
    p_payment_reference
  ) RETURNING id INTO v_order_id;

  -- Insert order items and decrement inventory
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    -- Check and decrement stock atomically
    UPDATE products
    SET stock = stock - (v_item->>'quantity')::INTEGER
    WHERE id = (
      SELECT product_id FROM ecommerce_products 
      WHERE id = (v_item->>'ecommerce_product_id')::UUID
    )
    RETURNING stock INTO v_stock;

    -- If stock went negative, rollback
    IF v_stock < 0 THEN
      RAISE EXCEPTION 'Insufficient stock for product %', v_item->>'ecommerce_product_id';
    END IF;

    -- Insert order item
    INSERT INTO order_items (
      order_id, ecommerce_product_id, product_name, quantity, unit_price_kobo
    ) VALUES (
      v_order_id,
      (v_item->>'ecommerce_product_id')::UUID,
      v_item->>'product_name',
      (v_item->>'quantity')::INTEGER,
      (v_item->>'unit_price_kobo')::INTEGER
    );
  END LOOP;

  -- Record initial status
  INSERT INTO order_status_history (order_id, status, changed_by)
  VALUES (v_order_id, 'pending_payment', p_customer_id);

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update order status with history
CREATE OR REPLACE FUNCTION update_order_status(
  p_order_id UUID,
  p_status TEXT,
  p_changed_by UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE orders
  SET status = p_status, updated_at = NOW()
  WHERE id = p_order_id;

  INSERT INTO order_status_history (order_id, status, changed_by)
  VALUES (p_order_id, p_status, p_changed_by);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to restore inventory on order cancellation
CREATE OR REPLACE FUNCTION restore_inventory_on_cancel(p_order_id UUID) RETURNS VOID AS $$
DECLARE
  v_item RECORD;
BEGIN
  FOR v_item IN SELECT * FROM order_items WHERE order_id = p_order_id LOOP
    UPDATE products
    SET stock = stock + v_item.quantity
    WHERE id = (
      SELECT product_id FROM ecommerce_products 
      WHERE id = v_item.ecommerce_product_id
    );
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_orders_updated_at();
