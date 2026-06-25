-- Modo Férias: pausa em massa anúncios cross-docking
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS vacation_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE;
