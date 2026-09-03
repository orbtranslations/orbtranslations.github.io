/**
 * Auth — Управление ролями (Гость / Пользователь / Администратор) и сессией
 */
class AuthManager {
  constructor(store) {
    this.store = store;
    this.listeners = [];
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

  logout() {
    this.setRole('guest');
  }

  // Симуляция быстрой регистрации
  registerDemoUser(name, email) {
    const user = this.store.getCurrentUser();
    user.name = name || 'Новый читатель';
    user.email = email || 'user@mail.com';
    this.store.saveToStorage();
    this.setRole('user');
  }
}

window.auth = new AuthManager(window.store);
