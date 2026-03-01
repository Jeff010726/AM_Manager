PRAGMA foreign_keys = ON;

ALTER TABLE inventory_transactions ADD COLUMN reverted_by_tx_id INTEGER;
ALTER TABLE inventory_transactions ADD COLUMN superseded_by_tx_id INTEGER;
ALTER TABLE inventory_transactions ADD COLUMN edited_from_tx_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_inventory_tx_reverted_by ON inventory_transactions(reverted_by_tx_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_edited_from ON inventory_transactions(edited_from_tx_id);
