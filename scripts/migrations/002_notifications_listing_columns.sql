-- Miniatura e link do anúncio em notificações de nova pergunta (ML)
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS listing_thumbnail_url TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS listing_permalink TEXT;
