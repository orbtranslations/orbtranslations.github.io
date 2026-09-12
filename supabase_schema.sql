-- ============================================================================
-- Orb Translations Platform — Схема базы данных Supabase (PostgreSQL)
-- Скопируйте этот код и запустите его в Supabase Dashboard -> SQL Editor -> Run
-- ============================================================================

-- 1. Таблица профилей пользователей (привязана к auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  orbs NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  role TEXT NOT NULL DEFAULT 'user', -- 'user' | 'admin'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Таблица каталога переводов
CREATE TABLE IF NOT EXISTS public.works (
  id TEXT PRIMARY KEY,
  title_ru TEXT NOT NULL,
  title_en TEXT,
  description_ru TEXT,
  description_en TEXT,
  author TEXT,
  price NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
  total_pages INT NOT NULL DEFAULT 1,
  preview_pages_count INT NOT NULL DEFAULT 3,
  tags TEXT[],
  cover_url TEXT,
  available_languages TEXT[],
  script_file_name TEXT,
  sample_script_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Таблица купленных работ
CREATE TABLE IF NOT EXISTS public.purchases (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  price_paid NUMERIC(10, 2) NOT NULL,
  purchased_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, work_id)
);

-- 4. Таблица заказов и криптовалютных оплат
CREATE TABLE IF NOT EXISTS public.crypto_orders (
  id TEXT PRIMARY KEY, -- ORD-142
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  network TEXT NOT NULL, -- 'USDT (TRC-20)', 'USDT (Polygon)', 'BTC'
  deposit_address TEXT NOT NULL,
  orbs_amount NUMERIC(10, 2) NOT NULL,
  expected_amount NUMERIC(18, 8) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'expired'
  tx_hash TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 5. Настройки кошельков платформы
CREATE TABLE IF NOT EXISTS public.wallet_settings (
  id INT PRIMARY KEY DEFAULT 1,
  trc20_address TEXT NOT NULL DEFAULT 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW',
  polygon_address TEXT NOT NULL DEFAULT '0x3b890765042948355e0a2b0769119d65fdba99ab',
  btc_address TEXT NOT NULL DEFAULT '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe',
  default_network TEXT NOT NULL DEFAULT 'USDT (TRC-20)',
  next_order_index INT NOT NULL DEFAULT 142
);

INSERT INTO public.wallet_settings (id, trc20_address, polygon_address, btc_address, default_network, next_order_index)
VALUES (1, 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW', '0x3b890765042948355e0a2b0769119d65fdba99ab', '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe', 'USDT (TRC-20)', 142)
ON CONFLICT (id) DO UPDATE 
SET trc20_address = EXCLUDED.trc20_address,
    polygon_address = EXCLUDED.polygon_address,
    btc_address = EXCLUDED.btc_address;

-- 6. Автоматическое создание профиля при регистрации в Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, orbs, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE 
      WHEN LOWER(NEW.email) = 'ismayilovelchin1984@gmail.com' THEN 'GraveAdmin'
      ELSE COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
    END,
    0.00,
    CASE 
      WHEN LOWER(NEW.email) = 'ismayilovelchin1984@gmail.com' THEN 'admin'
      ELSE 'user'
    END
  )
  ON CONFLICT (id) DO UPDATE
  SET 
    role = CASE 
      WHEN LOWER(NEW.email) = 'ismayilovelchin1984@gmail.com' THEN 'admin'
      ELSE profiles.role
    END,
    name = CASE 
      WHEN LOWER(NEW.email) = 'ismayilovelchin1984@gmail.com' THEN 'GraveAdmin'
      ELSE profiles.name
    END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Назначение роли администратора для GraveAdmin (если профиль уже был создан)
UPDATE public.profiles 
SET role = 'admin', name = 'GraveAdmin' 
WHERE LOWER(email) = 'ismayilovelchin1984@gmail.com';

-- 7. Безопасная серверная функция для завершения крипто-заказа
CREATE OR REPLACE FUNCTION public.complete_crypto_order(
  p_order_id TEXT,
  p_tx_hash TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_order RECORD;
  v_new_balance NUMERIC;
BEGIN
  SELECT * INTO v_order FROM public.crypto_orders WHERE id = p_order_id FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Заказ не найден');
  END IF;

  IF v_order.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Заказ уже был оплачен ранее');
  END IF;

  -- Проверка уникальности tx_hash
  IF p_tx_hash IS NOT NULL AND EXISTS (SELECT 1 FROM public.crypto_orders WHERE tx_hash = p_tx_hash AND id <> p_order_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Этот хэш транзакции уже использован для другого заказа');
  END IF;

  -- Обновление статуса заказа
  UPDATE public.crypto_orders
  SET status = 'completed',
      tx_hash = p_tx_hash,
      completed_at = NOW()
  WHERE id = p_order_id;

  -- Начисление баланса Орбов
  IF v_order.user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET orbs = orbs + v_order.orbs_amount,
        updated_at = NOW()
    WHERE id = v_order.user_id
    RETURNING orbs INTO v_new_balance;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'credited_orbs', v_order.orbs_amount,
    'new_balance', v_new_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7.1. Вспомогательная функция проверки роли администратора (SECURITY DEFINER исключает рекурсию RLS)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Включение RLS (Row Level Security) для защиты таблиц
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crypto_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_settings ENABLE ROW LEVEL SECURITY;

-- Удаление старых политик при повторном накате
DROP POLICY IF EXISTS "Public read works" ON public.works;
DROP POLICY IF EXISTS "Public read wallet_settings" ON public.wallet_settings;
DROP POLICY IF EXISTS "Read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Read own purchases" ON public.purchases;
DROP POLICY IF EXISTS "Insert own purchases" ON public.purchases;
DROP POLICY IF EXISTS "Read own orders" ON public.crypto_orders;
DROP POLICY IF EXISTS "Read orders" ON public.crypto_orders;
DROP POLICY IF EXISTS "Insert orders" ON public.crypto_orders;
DROP POLICY IF EXISTS "Update orders" ON public.crypto_orders;
DROP POLICY IF EXISTS "Delete orders" ON public.crypto_orders;

-- Чтение каталога и настроек доступно всем
CREATE POLICY "Public read works" ON public.works FOR SELECT USING (true);
CREATE POLICY "Public read wallet_settings" ON public.wallet_settings FOR SELECT USING (true);

-- Профили: пользователи видят и обновляют свой профиль, а администраторы — любые профили (для изменения баланса)
CREATE POLICY "Users read profiles" ON public.profiles FOR SELECT USING (auth.uid() = id OR public.is_admin());
CREATE POLICY "Users update profiles" ON public.profiles FOR UPDATE USING (auth.uid() = id OR public.is_admin()) WITH CHECK (auth.uid() = id OR public.is_admin());

-- Покупки: чтение и вставка своих покупок
CREATE POLICY "Read own purchases" ON public.purchases FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert own purchases" ON public.purchases FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Заказы: пользователи могут создавать, просматривать, обновлять и удалять заказы (администраторы могут стирать сделки)
CREATE POLICY "Read orders" ON public.crypto_orders FOR SELECT USING (true);
CREATE POLICY "Insert orders" ON public.crypto_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Update orders" ON public.crypto_orders FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Delete orders" ON public.crypto_orders FOR DELETE USING (true);

-- 9. Права доступа к таблицам и процедурам для PostgREST API (роли anon и authenticated)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.profiles TO anon, authenticated;
GRANT SELECT ON TABLE public.works TO anon, authenticated;
GRANT ALL ON TABLE public.purchases TO anon, authenticated;
GRANT ALL ON TABLE public.crypto_orders TO anon, authenticated;
GRANT SELECT ON TABLE public.wallet_settings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_crypto_order(TEXT, TEXT) TO anon, authenticated;
