ALTER TABLE payments
ADD COLUMN IF NOT EXISTS toss_order_id VARCHAR(255);

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS raw_response JSONB;

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS failed_at TIMESTAMP;

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS failure_reason TEXT;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMP;

UPDATE funding_support_options
SET remaining_stock = stock
WHERE remaining_stock IS NULL
AND stock IS NOT NULL;
