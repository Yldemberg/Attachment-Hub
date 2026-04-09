-- ============================================================================
-- iHub - Full Supabase Schema
-- Run this script against your Supabase project via SQL Editor
-- ============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABLE: profiles
-- 1:1 with auth.users — auto-created via trigger on signup
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT,
  email           TEXT,
  avatar_url      TEXT,
  plan            TEXT NOT NULL DEFAULT 'trial',
  trial_ends_at   TIMESTAMPTZ,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TABLE: accounts (Mercado Livre integrations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.accounts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ml_user_id       TEXT,
  ml_nickname      TEXT,
  ml_email         TEXT,
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at TIMESTAMPTZ,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- TABLE: products
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.products (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id         UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  ml_item_id         TEXT NOT NULL,
  title              TEXT,
  sku                TEXT,
  price              DECIMAL(10,2),
  available_quantity INTEGER NOT NULL DEFAULT 0,
  sold_quantity      INTEGER NOT NULL DEFAULT 0,
  status             TEXT,
  listing_type       TEXT,
  logistic_type      TEXT,
  is_full            BOOLEAN NOT NULL DEFAULT FALSE,
  thumbnail          TEXT,
  permalink          TEXT,
  ml_category_id     TEXT,
  last_synced_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, ml_item_id)
);

CREATE INDEX IF NOT EXISTS products_account_id_idx ON public.products(account_id);
CREATE INDEX IF NOT EXISTS products_sku_idx ON public.products(sku) WHERE sku IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_status_idx ON public.products(status);

-- ============================================================================
-- TABLE: orders
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.orders (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  ml_order_id      BIGINT NOT NULL,
  status           TEXT,
  total_amount     DECIMAL(10,2),
  currency_id      TEXT DEFAULT 'BRL',
  buyer_id         BIGINT,
  buyer_nickname   TEXT,
  shipping_id      BIGINT,
  shipping_status  TEXT,
  date_created     TIMESTAMPTZ,
  date_closed      TIMESTAMPTZ,
  items_json       JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, ml_order_id)
);

CREATE INDEX IF NOT EXISTS orders_account_id_idx ON public.orders(account_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON public.orders(status);
CREATE INDEX IF NOT EXISTS orders_date_created_idx ON public.orders(date_created DESC);

-- ============================================================================
-- TABLE: questions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.questions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  ml_question_id      BIGINT NOT NULL,
  ml_item_id          TEXT,
  text                TEXT,
  status              TEXT NOT NULL DEFAULT 'unanswered',
  from_user_id        BIGINT,
  from_user_nickname  TEXT,
  answer_text         TEXT,
  answer_date         TIMESTAMPTZ,
  date_created        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, ml_question_id)
);

CREATE INDEX IF NOT EXISTS questions_account_id_idx ON public.questions(account_id);
CREATE INDEX IF NOT EXISTS questions_status_idx ON public.questions(status);

-- ============================================================================
-- TABLE: notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  is_read       BOOLEAN NOT NULL DEFAULT FALSE,
  resource_type TEXT,
  resource_id   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_is_read_idx ON public.notifications(user_id, is_read);

-- ============================================================================
-- TRIGGER: update_updated_at
-- Generic trigger function to keep updated_at = NOW() on every UPDATE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER profiles_update_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER accounts_update_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER products_update_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER orders_update_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE TRIGGER questions_update_updated_at
  BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================================
-- TRIGGER: handle_new_user
-- After a new user signs up via Supabase Auth, create their profile automatically
-- with a 30-day trial period.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, plan, trial_ends_at)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    'trial',
    NOW() + INTERVAL '30 days'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists, then recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- profiles: users can only read/update their own record
-- --------------------------------------------------------------------------
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- --------------------------------------------------------------------------
-- accounts: users can only access their own connected accounts
-- --------------------------------------------------------------------------
CREATE POLICY "accounts_select_own" ON public.accounts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "accounts_insert_own" ON public.accounts
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "accounts_update_own" ON public.accounts
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "accounts_delete_own" ON public.accounts
  FOR DELETE USING (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- products: access via account ownership
-- --------------------------------------------------------------------------
CREATE POLICY "products_select_own" ON public.products
  FOR SELECT USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

CREATE POLICY "products_insert_own" ON public.products
  FOR INSERT WITH CHECK (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

CREATE POLICY "products_update_own" ON public.products
  FOR UPDATE USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

CREATE POLICY "products_delete_own" ON public.products
  FOR DELETE USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

-- --------------------------------------------------------------------------
-- orders: access via account ownership
-- --------------------------------------------------------------------------
CREATE POLICY "orders_select_own" ON public.orders
  FOR SELECT USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

CREATE POLICY "orders_insert_own" ON public.orders
  FOR INSERT WITH CHECK (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

CREATE POLICY "orders_update_own" ON public.orders
  FOR UPDATE USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

-- --------------------------------------------------------------------------
-- questions: access via account ownership
-- --------------------------------------------------------------------------
CREATE POLICY "questions_select_own" ON public.questions
  FOR SELECT USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

CREATE POLICY "questions_insert_own" ON public.questions
  FOR INSERT WITH CHECK (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

CREATE POLICY "questions_update_own" ON public.questions
  FOR UPDATE USING (
    account_id IN (SELECT id FROM public.accounts WHERE user_id = auth.uid())
  );

-- --------------------------------------------------------------------------
-- notifications: users can only see their own notifications
-- --------------------------------------------------------------------------
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "notifications_insert_own" ON public.notifications
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());

-- ============================================================================
-- Enable Realtime for notifications table (for in-app real-time updates)
-- ============================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ============================================================================
-- End of schema
-- ============================================================================
