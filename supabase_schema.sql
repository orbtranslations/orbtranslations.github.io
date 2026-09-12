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
  demo_images JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Миграция для добавления demo_images в существующую таблицу
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS demo_images JSONB DEFAULT '[]'::jsonb;

-- 2.1. Защищенная таблица полных скриптов перевода (доступна только покупателям и администраторам)
CREATE TABLE IF NOT EXISTS public.work_scripts (
  work_id TEXT PRIMARY KEY REFERENCES public.works(id) ON DELETE CASCADE,
  full_script_text TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Автоматический перенос существующих скриптов из works в work_scripts при первом накате
INSERT INTO public.work_scripts (work_id, full_script_text)
SELECT id, sample_script_text
FROM public.works
WHERE sample_script_text IS NOT NULL AND sample_script_text != ''
ON CONFLICT (work_id) DO UPDATE
SET full_script_text = EXCLUDED.full_script_text;

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

-- 6.1. Автоматическая синхронизация всех пользователей из auth.users в public.profiles (подтягивает тех, кто уже зарегистрировался)
INSERT INTO public.profiles (id, email, name, orbs, role, created_at)
SELECT 
  u.id, 
  u.email, 
  CASE 
    WHEN LOWER(u.email) = 'ismayilovelchin1984@gmail.com' THEN 'GraveAdmin'
    ELSE COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1))
  END, 
  0.00, 
  CASE 
    WHEN LOWER(u.email) = 'ismayilovelchin1984@gmail.com' THEN 'admin' 
    ELSE 'user' 
  END,
  COALESCE(u.created_at, NOW())
FROM auth.users u
ON CONFLICT (id) DO UPDATE
SET 
  email = EXCLUDED.email,
  name = CASE 
    WHEN LOWER(EXCLUDED.email) = 'ismayilovelchin1984@gmail.com' THEN 'GraveAdmin' 
    ELSE COALESCE(profiles.name, EXCLUDED.name) 
  END;

-- Назначение роли администратора для GraveAdmin (если профиль уже был создан)
UPDATE public.profiles 
SET role = 'admin', name = 'GraveAdmin' 
WHERE LOWER(email) = 'ismayilovelchin1984@gmail.com';

-- Гарантия неделимости орбов: приведение всех текущих балансов в БД к строго целым числам
UPDATE public.profiles 
SET orbs = FLOOR(orbs);

-- 7. Безопасная серверная функция для завершения крипто-заказа
DROP FUNCTION IF EXISTS public.complete_crypto_order(TEXT, TEXT) CASCADE;
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
  IF EXISTS (SELECT 1 FROM public.crypto_orders WHERE tx_hash = p_tx_hash AND id != p_order_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Данный tx_hash уже привязан к другому заказу');
  END IF;

  -- Обновление статуса заказа
  UPDATE public.crypto_orders
  SET status = 'completed',
      tx_hash = p_tx_hash,
      completed_at = NOW()
  WHERE id = p_order_id;

  -- Начисление баланса Орбов (всегда строго целое число)
  IF v_order.user_id IS NOT NULL THEN
    UPDATE public.profiles
    SET orbs = FLOOR(orbs + v_order.orbs_amount),
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Сброс зависимой политики перед пересозданием is_admin
DROP POLICY IF EXISTS "Users update profiles" ON public.profiles;

-- 7.1. Вспомогательная функция проверки роли администратора (SECURITY DEFINER исключает рекурсию RLS)
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- 1. Проверка по email главного администратора напрямую из JWT токена
  IF LOWER(COALESCE(auth.jwt()->>'email', '')) = 'ismayilovelchin1984@gmail.com' THEN
    RETURN true;
  END IF;

  -- 2. Проверка по роли admin в таблице profiles
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7.2. Серверная функция для панели администратора (гарантирует синхронизацию auth.users и profiles)
DROP FUNCTION IF EXISTS public.get_admin_users() CASCADE;
DROP FUNCTION IF EXISTS get_admin_users() CASCADE;
CREATE OR REPLACE FUNCTION public.get_admin_users()
RETURNS SETOF public.profiles AS $$
BEGIN
  -- Автоматически синхронизируем пользователей из auth.users в public.profiles
  INSERT INTO public.profiles (id, email, name, orbs, role, created_at)
  SELECT 
    u.id, 
    u.email, 
    CASE 
      WHEN LOWER(u.email) = 'ismayilovelchin1984@gmail.com' THEN 'GraveAdmin'
      ELSE COALESCE(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1))
    END, 
    0, 
    CASE 
      WHEN LOWER(u.email) = 'ismayilovelchin1984@gmail.com' THEN 'admin' 
      ELSE 'user' 
    END,
    COALESCE(u.created_at, NOW())
  FROM auth.users u
  WHERE u.email IS NOT NULL
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email;

  RETURN QUERY
  SELECT *
  FROM public.profiles
  ORDER BY created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth;

-- 7.3. Серверная функция удаления отдельной сделки (SECURITY DEFINER)
DROP FUNCTION IF EXISTS public.delete_crypto_order(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.delete_crypto_order(p_order_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM public.crypto_orders
  WHERE id = p_order_id;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_count,
    'order_id', p_order_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7.4. Серверная функция полной очистки сделок конкретного пользователя
DROP FUNCTION IF EXISTS public.clear_user_crypto_orders(UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.clear_user_crypto_orders(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM public.crypto_orders
  WHERE user_id = p_user_id;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_count,
    'user_id', p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7.5. Серверная функция удаления отдельной покупки и отзыва доступа
DROP FUNCTION IF EXISTS public.delete_user_purchase(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.delete_user_purchase(TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.delete_user_purchase(TEXT, TEXT, TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.delete_user_purchase(
  p_user_id TEXT,
  p_work_id TEXT DEFAULT NULL,
  p_order_id TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_count INT := 0;
  v_uid UUID;
BEGIN
  BEGIN
    v_uid := p_user_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_uid := NULL;
  END;

  IF p_order_id IS NOT NULL AND p_order_id ~ '^[0-9]+$' THEN
    DELETE FROM public.purchases WHERE id = p_order_id::BIGINT;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  ELSIF v_uid IS NOT NULL THEN
    IF p_work_id IS NOT NULL AND p_work_id <> '' THEN
      DELETE FROM public.purchases WHERE user_id = v_uid AND work_id = p_work_id;
    ELSE
      DELETE FROM public.purchases WHERE user_id = v_uid;
    END IF;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_count,
    'user_id', p_user_id,
    'work_id', p_work_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Перегрузка для совместимости с прямым вызовом по UUID
CREATE OR REPLACE FUNCTION public.delete_user_purchase(p_user_id UUID, p_work_id TEXT)
RETURNS JSONB AS $$
BEGIN
  RETURN public.delete_user_purchase(p_user_id::TEXT, p_work_id, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7.6. Серверная функция полной очистки всех покупок пользователя
DROP FUNCTION IF EXISTS public.clear_user_purchases(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.clear_user_purchases(TEXT) CASCADE;

CREATE OR REPLACE FUNCTION public.clear_user_purchases(p_user_id TEXT)
RETURNS JSONB AS $$
DECLARE
  v_count INT := 0;
  v_uid UUID;
BEGIN
  BEGIN
    v_uid := p_user_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_uid := NULL;
  END;

  IF v_uid IS NOT NULL THEN
    DELETE FROM public.purchases WHERE user_id = v_uid;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_count,
    'user_id', p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.clear_user_purchases(p_user_id UUID)
RETURNS JSONB AS $$
BEGIN
  RETURN public.clear_user_purchases(p_user_id::TEXT);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8. Включение RLS (Row Level Security) для защиты таблиц
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crypto_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_settings ENABLE ROW LEVEL SECURITY;

-- Удаление старых политик при повторном накате
DROP POLICY IF EXISTS "Public read works" ON public.works;
DROP POLICY IF EXISTS "Admin manage works" ON public.works;
DROP POLICY IF EXISTS "Admin manage work scripts" ON public.work_scripts;
DROP POLICY IF EXISTS "Read work script if purchased or admin" ON public.work_scripts;
DROP POLICY IF EXISTS "Public read wallet_settings" ON public.wallet_settings;
DROP POLICY IF EXISTS "Read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow profile insert" ON public.profiles;
DROP POLICY IF EXISTS "Read own purchases" ON public.purchases;
DROP POLICY IF EXISTS "Insert own purchases" ON public.purchases;
DROP POLICY IF EXISTS "Read purchases" ON public.purchases;
DROP POLICY IF EXISTS "Delete purchases" ON public.purchases;
DROP POLICY IF EXISTS "Read own orders" ON public.crypto_orders;
DROP POLICY IF EXISTS "Read orders" ON public.crypto_orders;
DROP POLICY IF EXISTS "Insert orders" ON public.crypto_orders;
DROP POLICY IF EXISTS "Update orders" ON public.crypto_orders;
DROP POLICY IF EXISTS "Delete orders" ON public.crypto_orders;

-- 8.1. Каталог работ: публичное чтение метаданных и превью, управление — только администратору
CREATE POLICY "Public read works" ON public.works FOR SELECT USING (true);
CREATE POLICY "Admin manage works" ON public.works FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 8.2. Полные скрипты перевода: чтение только при наличии покупки или роли администратора
CREATE POLICY "Read work script if purchased or admin" ON public.work_scripts FOR SELECT
  USING (
    public.is_admin() OR 
    EXISTS (
      SELECT 1 FROM public.purchases 
      WHERE purchases.user_id = auth.uid() 
        AND purchases.work_id = work_scripts.work_id
    )
  );
CREATE POLICY "Admin manage work scripts" ON public.work_scripts FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 8.3. Настройки кошельков: публичное чтение
CREATE POLICY "Public read wallet_settings" ON public.wallet_settings FOR SELECT USING (true);

-- 8.4. Профили: чтение и вставка доступны всем пользователям, а обновление баланса — владельцу или администратору
CREATE POLICY "Users read profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users insert profiles" ON public.profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Users update profiles" ON public.profiles FOR UPDATE USING (auth.uid() = id OR public.is_admin()) WITH CHECK (auth.uid() = id OR public.is_admin());

-- 8.5. Покупки: чтение, вставка и удаление покупок (для пользователей и администраторов)
CREATE POLICY "Read purchases" ON public.purchases FOR SELECT USING (true);
CREATE POLICY "Insert own purchases" ON public.purchases FOR INSERT WITH CHECK (true);
CREATE POLICY "Delete purchases" ON public.purchases FOR DELETE USING (true);

-- 8.6. Заказы: пользователи могут создавать, просматривать, обновлять и удалять заказы (администраторы могут стирать сделки)
CREATE POLICY "Read orders" ON public.crypto_orders FOR SELECT USING (true);
CREATE POLICY "Insert orders" ON public.crypto_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Update orders" ON public.crypto_orders FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Delete orders" ON public.crypto_orders FOR DELETE USING (true);

-- 8.7. Закрытый бакет Storage work-scripts (1 GB) и политики доступа
INSERT INTO storage.buckets (id, name, public)
VALUES ('work-scripts', 'work-scripts', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Admin upload work scripts" ON storage.objects;
DROP POLICY IF EXISTS "Admin update work scripts" ON storage.objects;
DROP POLICY IF EXISTS "Admin delete work scripts" ON storage.objects;
DROP POLICY IF EXISTS "Admin read work scripts" ON storage.objects;

CREATE POLICY "Admin upload work scripts" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'work-scripts' AND public.is_admin());

CREATE POLICY "Admin update work scripts" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'work-scripts' AND public.is_admin());

CREATE POLICY "Admin delete work scripts" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'work-scripts' AND public.is_admin());

CREATE POLICY "Admin read work scripts" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'work-scripts' AND public.is_admin());

-- 9. Права доступа к таблицам и процедурам для PostgREST API (роли anon и authenticated)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.profiles TO anon, authenticated;
GRANT ALL ON TABLE public.works TO anon, authenticated;
GRANT ALL ON TABLE public.work_scripts TO anon, authenticated;
GRANT ALL ON TABLE public.purchases TO anon, authenticated;
GRANT ALL ON TABLE public.crypto_orders TO anon, authenticated;
GRANT SELECT ON TABLE public.wallet_settings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_crypto_order(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_users() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_crypto_order(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_user_crypto_orders(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_purchase(TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_purchase(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_user_purchases(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_user_purchases(UUID) TO anon, authenticated;

-- 10. Очистка устаревших тестовых записей без пользователя
DELETE FROM public.crypto_orders WHERE id IN ('TEST-1', 'TEST-UPDATE') OR user_id IS NULL;

-- ========================================================================
-- 11. Система обратной связи (Feedback & Support) и настройки платформы
-- ========================================================================

-- Таблица тикетов и обращений пользователей
CREATE TABLE IF NOT EXISTS public.feedback_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  contact_info TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- 'new', 'in_progress', 'resolved'
  admin_notes TEXT
);

-- Таблица настроек платформы и Telegram-бота
CREATE TABLE IF NOT EXISTS public.site_settings (
  id INT PRIMARY KEY DEFAULT 1,
  telegram_bot_token TEXT DEFAULT '',
  telegram_chat_id TEXT DEFAULT '276204182',
  telegram_enabled BOOLEAN DEFAULT true,
  support_telegram_username TEXT DEFAULT 'OrbTranslationsSupportBot',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Инициализация начальной строки настроек платформы
INSERT INTO public.site_settings (id, telegram_bot_token, telegram_chat_id, telegram_enabled, support_telegram_username)
VALUES (1, '', '276204182', true, 'OrbTranslationsSupportBot')
ON CONFLICT (id) DO NOTHING;

-- Включение RLS
ALTER TABLE public.feedback_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

-- RLS для feedback_messages
DROP POLICY IF EXISTS "Anyone can submit feedback" ON public.feedback_messages;
CREATE POLICY "Anyone can submit feedback" ON public.feedback_messages
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admin view all feedback" ON public.feedback_messages;
CREATE POLICY "Admin view all feedback" ON public.feedback_messages
  FOR SELECT USING (public.is_admin() OR (auth.uid() IS NOT NULL AND auth.uid() = user_id));

DROP POLICY IF EXISTS "Admin update feedback" ON public.feedback_messages;
CREATE POLICY "Admin update feedback" ON public.feedback_messages
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin delete feedback" ON public.feedback_messages;
CREATE POLICY "Admin delete feedback" ON public.feedback_messages
  FOR DELETE USING (public.is_admin());

-- RLS для site_settings
DROP POLICY IF EXISTS "Public read site_settings" ON public.site_settings;
CREATE POLICY "Public read site_settings" ON public.site_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin manage site_settings" ON public.site_settings;
CREATE POLICY "Admin manage site_settings" ON public.site_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Права доступа
GRANT ALL ON TABLE public.feedback_messages TO anon, authenticated;
GRANT ALL ON TABLE public.site_settings TO anon, authenticated;

