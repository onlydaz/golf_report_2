CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL CHECK (username ~ '^[a-zA-Z0-9_.-]{3,64}$'),
    display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
    password_hash TEXT NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'OPERATOR')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_admin_identity CHECK (
        (role = 'ADMIN' AND username = 'admin' AND is_active)
        OR (role = 'OPERATOR' AND lower(username) <> 'admin')
    )
);

CREATE UNIQUE INDEX users_username_unique ON users (lower(username));
CREATE UNIQUE INDEX users_single_admin ON users (role) WHERE role = 'ADMIN';

-- The bootstrap inserts the only Admin; subsequent changes cannot remove or demote it.
CREATE FUNCTION protect_user_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.role = 'ADMIN' THEN
            RAISE EXCEPTION 'Cannot delete the administrator';
        END IF;
        RETURN OLD;
    END IF;
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.username IS DISTINCT FROM OLD.username
       OR NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'User identity is immutable';
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER users_protect_identity BEFORE UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION protect_user_identity();
