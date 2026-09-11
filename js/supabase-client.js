/**
 * Supabase Client Initialization
 * Подключение к облачной базе данных PostgreSQL и Auth
 */
const SUPABASE_CONFIG = {
  url: 'https://xbxnjdpkvmwtmkcjkoxe.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieG5qZHBrdm13dG1rY2prb3hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzUxMTcsImV4cCI6MjEwNDcxMTExN30.54k7DJQNCzfVeWbqeqENzefwkvAbzZI5AJ0BE7WdoXE'
};

let supabaseClient = null;

try {
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    console.log('✅ Supabase Client успешно инициализирован');
  } else {
    console.warn('⚠️ Библиотека Supabase не найдена, включен автономный режим (localStorage)');
  }
} catch (err) {
  console.warn('⚠️ Ошибка инициализации Supabase:', err);
}

window.supabaseClient = supabaseClient;
