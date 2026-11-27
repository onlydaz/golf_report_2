-- Remove the obsolete requirement for both existing and newly created accounts.
-- Password hashes and all other account data remain unchanged.
ALTER TABLE users DROP COLUMN must_change_password;
