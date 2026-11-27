-- Identity captured on receipt, not inferred from the later DB insertion timestamp.
-- Historical rows remain unassigned and are still available in SKU history.
ALTER TABLE stick ADD COLUMN production_session TEXT;
CREATE INDEX stick_production_session_idx ON stick (production_session, product_code)
    WHERE production_session IS NOT NULL;
