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

      // 3. Автоматическая подготовка аккаунта администратора GraveAdmin
      this.ensureAdminAccount();
    } catch (e) {
      console.warn('Ошибка при инициализации Supabase Auth:', e);
    }
  }

  /**
   * Проверка и предварительное создание аккаунта администратора в Supabase
   */
  async ensureAdminAccount() {
    if (!window.supabaseClient) return;
    try {
      const adminEmail = 'ismayilovelchin1984@gmail.com';
      const adminPass = 'ZlY263ws31Th5FMZ';
      const adminName = 'GraveAdmin';

      const { data, error } = await window.supabaseClient.auth.signUp({
        email: adminEmail,
        password: adminPass,
        options: {
          data: { name: adminName }
        }
      });

      if (data && data.user) {
        // Назначаем роль admin в таблице public.profiles
        await window.supabaseClient
          .from('profiles')
          .update({ role: 'admin', name: adminName })
          .eq('id', data.user.id);
      }
    } catch (e) {
      // Если аккаунт уже создан — пропускаем
    }
  }

  async syncUserFromSupabase(sbUser) {
    this.supabaseUser = sbUser;
    try {
      // Получаем профиль из таблицы public.profiles
      const { data: profile } = await window.supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', sbUser.id)
        .single();

      const user = this.store.getCurrentUser();
      user.id = sbUser.id;
      user.email = sbUser.email;

      const isAdminEmail = (sbUser.email || '').toLowerCase() === 'ismayilovelchin1984@gmail.com';
      user.name = isAdminEmail 
        ? 'GraveAdmin' 
        : ((profile && profile.name) || sbUser.user_metadata?.name || sbUser.email.split('@')[0]);

      if (profile && profile.orbs !== undefined) {
        user.orbs = Number(profile.orbs);
      }
      
      const role = isAdminEmail ? 'admin' : ((profile && profile.role) || 'user');
      this.store.setRole(role);

      // Если в базе еще не была проставлена роль admin для главного email
      if (isAdminEmail && profile && profile.role !== 'admin') {
        window.supabaseClient
          .from('profiles')
          .update({ role: 'admin', name: 'GraveAdmin' })
          .eq('id', sbUser.id)
          .then(() => {});
      }

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
    user.purchasedWorks = [];
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
    if (data.user) {
      await this.syncUserFromSupabase(data.user);
    }
    return { success: true, user: data.user };
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
    user.name = name || 'Иван Переводчик';
    user.email = email || 'reader@studio.com';
    this.store.saveToStorage();
    this.setRole('user');
  }
}

window.auth = new AuthManager(window.store);

