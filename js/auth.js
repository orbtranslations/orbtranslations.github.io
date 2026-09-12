/**
 * Auth — Управление ролями (Гость / Пользователь / Администратор) и сессией
 * Поддерживает как Supabase Auth (облачная авторизация), так и быстрый режим переключения ролей
 */
class AuthManager {
  constructor(store) {
    this.store = store;
    this.listeners = [];
    this.supabaseUser = null;
    this.initSupabaseAuth();
  }

  async initSupabaseAuth() {
    if (!window.supabaseClient) return;

    try {
      // 1. Проверяем текущую активную сессию
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      if (session && session.user) {
        await this.syncUserFromSupabase(session.user);
      } else {
        // Если активной сессии нет — строго роль гостя
        this.supabaseUser = null;
        this.store.setRole('guest');
      }

      // 2. Слушаем события авторизации (вход, выход, обновление токена, восстановление пароля)
      window.supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          if (window.app) window.app.showNewPasswordModal();
          return;
        }

        if (session && session.user) {
          await this.syncUserFromSupabase(session.user);
        } else {
          this.supabaseUser = null;
          this.store.setRole('guest');
        }
        this.notify();
      });

    } catch (e) {
      console.warn('Ошибка при инициализации Supabase Auth:', e);
    }
  }

  async syncUserFromSupabase(sbUser) {
    this.supabaseUser = sbUser;
    try {
      const isAdminEmail = (sbUser.email || '').toLowerCase() === 'ismayilovelchin1984@gmail.com';
      const defaultName = isAdminEmail 
        ? 'GraveAdmin' 
        : (sbUser.user_metadata?.name || (sbUser.email ? sbUser.email.split('@')[0] : 'User'));
      const defaultRole = isAdminEmail ? 'admin' : 'user';

      // 1. Получаем профиль из таблицы public.profiles
      let { data: profile } = await window.supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', sbUser.id)
        .maybeSingle();

      // 2. Если профиля еще нет в profiles — создаем его немедленно
      if (!profile) {
        try {
          const { data: insertedProfile } = await window.supabaseClient
            .from('profiles')
            .upsert({
              id: sbUser.id,
              email: sbUser.email,
              name: defaultName,
              orbs: 0,
              role: defaultRole
            }, { onConflict: 'id' })
            .select('*')
            .maybeSingle();
          if (insertedProfile) profile = insertedProfile;
        } catch (insertErr) {
          console.warn('Автоматическое создание профиля в profiles:', insertErr);
        }
      }

      const user = this.store.getCurrentUser();
      user.id = sbUser.id;
      user.email = sbUser.email;
      user.name = (profile && profile.name) || defaultName;

      if (profile && profile.orbs !== undefined) {
        user.orbs = Math.floor(Number(profile.orbs || 0));
      }
      
      const role = isAdminEmail ? 'admin' : ((profile && profile.role) || defaultRole);
      this.store.setRole(role);

      // 3. Загружаем купленные работы пользователя из public.purchases
      if (window.supabaseClient && sbUser && sbUser.id) {
        try {
          const { data: dbPurchases, error: pErr } = await window.supabaseClient
            .from('purchases')
            .select('work_id')
            .eq('user_id', sbUser.id);

          if (!pErr && dbPurchases && Array.isArray(dbPurchases)) {
            const ids = dbPurchases.map(p => p.work_id);
            this.store.setPurchasedWorks(ids);
          }
        } catch (pErr) {
          console.warn('Ошибка загрузки покупок пользователя из Supabase:', pErr);
        }
      }

      // Запоминаем пользователя в локальном хранилище
      this.store.recordRegisteredUser({
        id: user.id,
        email: user.email,
        name: user.name,
        role: role,
        orbs: Math.floor(Number(user.orbs || 0))
      });

      this.store.saveToStorage();
      this.notify();
    } catch (e) {
      console.warn('Не удалось синхронизировать профиль Supabase:', e);
    }
  }

  onChange(callback) {
    this.listeners.push(callback);
  }

  notify() {
    this.listeners.forEach(cb => cb(this.getRole(), this.getUser()));
  }

  getRole() {
    return this.store.getRole();
  }

  isGuest() {
    return this.getRole() === 'guest';
  }

  isUser() {
    return this.getRole() === 'user';
  }

  isAdmin() {
    return this.getRole() === 'admin';
  }

  getUser() {
    return this.store.getCurrentUser();
  }

  setRole(newRole) {
    this.store.setRole(newRole);
    this.notify();
  }

  loginAs(roleName) {
    this.setRole(roleName);
  }

  async logout() {
    if (window.supabaseClient) {
      try {
        await window.supabaseClient.auth.signOut();
      } catch (e) {
        console.warn('Ошибка при выходе из Supabase:', e);
      }
    }
    this.supabaseUser = null;
    const user = this.store.getCurrentUser();
    user.id = 'guest';
    user.name = 'Гость';
    user.email = '';
    user.orbs = 0;
    // Сохраняем доступ к работам, купленным на этом устройстве
    user.purchasedWorks = this.store.getDevicePurchases();
    this.store.saveToStorage();
    this.setRole('guest');
  }

  // Регистрация в Supabase Auth
  async signUpSupabase(email, password, name) {
    if (!window.supabaseClient) {
      this.registerDemoUser(name, email);
      return { success: true, mode: 'demo' };
    }

    const { data, error } = await window.supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { name: name || email.split('@')[0] }
      }
    });

    if (error) throw error;
    if (data && data.user) {
      const displayName = name || data.user.user_metadata?.name || email.split('@')[0];
      // Сразу создаем запись в таблице profiles
      try {
        await window.supabaseClient
          .from('profiles')
          .upsert({
            id: data.user.id,
            email: data.user.email,
            name: displayName,
            orbs: 0.00,
            role: 'user'
          }, { onConflict: 'id' });
      } catch (upsertErr) {
        console.warn('Создание записи профиля при регистрации:', upsertErr);
      }

      this.store.recordRegisteredUser({
        id: data.user.id,
        email: data.user.email,
        name: displayName,
        role: 'user',
        orbs: 0.00
      });

      await this.syncUserFromSupabase(data.user);
    }
    return { success: true, user: data ? data.user : null };
  }

  // Вход в Supabase Auth
  async signInSupabase(email, password) {
    if (!window.supabaseClient) {
      this.registerDemoUser(email.split('@')[0], email);
      return { success: true, mode: 'demo' };
    }

    const { data, error } = await window.supabaseClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    if (data.user) {
      await this.syncUserFromSupabase(data.user);
    }
    return { success: true, user: data.user };
  }

  // Запрос на восстановление пароля по email
  async resetPassword(email) {
    if (!window.supabaseClient) {
      throw new Error('Подключение к Supabase не активно');
    }

    const redirectUrl = window.location.href.split('#')[0];
    const { data, error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: redirectUrl
    });

    if (error) throw error;
    return { success: true, data };
  }

  // Установка нового пароля
  async updateUserPassword(newPassword) {
    if (!window.supabaseClient) {
      throw new Error('Подключение к Supabase не активно');
    }

    const { data, error } = await window.supabaseClient.auth.updateUser({
      password: newPassword
    });

    if (error) throw error;
    if (data.user) {
      await this.syncUserFromSupabase(data.user);
    }
    return { success: true, user: data.user };
  }

  // Симуляция быстрой регистрации (для локального офлайн-тестирования)
  registerDemoUser(name, email) {
    const user = this.store.getCurrentUser();
    user.id = 'usr_' + Date.now().toString(36);
    user.name = name || 'Иван Переводчик';
    user.email = email || 'reader@studio.com';
    user.orbs = 0;
    this.store.recordRegisteredUser({
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'user',
      orbs: 0
    });
    this.store.saveToStorage();
    this.setRole('user');
  }
}

window.auth = new AuthManager(window.store);

