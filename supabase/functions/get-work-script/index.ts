// Supabase Edge Function: get-work-script
// Безопасная отдача скриптов перевода из закрытого бакета Storage (1 GB)
// Доступ разрешен только покупателям (запись в purchases) или администраторам

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

// Заголовки CORS для вызовов из браузера
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // 1. Обработка CORS Preflight запроса
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    // Клиент с правами администратора сервера для чтения закрытого Storage и проверки БД
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 2. Чтение тела запроса
    const { workId, full = true } = await req.json();

    if (!workId) {
      return new Response(
        JSON.stringify({ error: "Параметр workId обязателен" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Проверка авторизации пользователя через переданный JWT токен
    const authHeader = req.headers.get("Authorization");
    let isAuthorized = false;
    let userEmail = "";
    let userId = "";

    if (authHeader) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();

      if (user) {
        userId = user.id;
        userEmail = (user.email || "").toLowerCase();

        // Проверка: является ли пользователь главным администратором
        if (userEmail === "ismayilovelchin1984@gmail.com") {
          isAuthorized = true;
        } else {
          // Проверка роли admin в таблице profiles
          const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("role")
            .eq("id", userId)
            .single();

          if (profile && profile.role === "admin") {
            isAuthorized = true;
          }
        }

        // Если не админ — проверяем факт покупки работы в таблице purchases
        if (!isAuthorized) {
          const { data: purchase } = await supabaseAdmin
            .from("purchases")
            .select("id")
            .eq("user_id", userId)
            .eq("work_id", workId)
            .maybeSingle();

          if (purchase) {
            isAuthorized = true;
          }
        }
      }
    }

    // Если работа не куплена и пользователь не админ — доступ запрещен
    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ 
          error: "Доступ запрещен. Для получения полного перевода необходимо приобрести работу.",
          purchased: false 
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Загрузка закрытого файла скрипта из Private Storage (бакет work-scripts)
    const filePath = `${workId}.txt`;
    const { data: fileBlob, error: storageErr } = await supabaseAdmin.storage
      .from("work-scripts")
      .download(filePath);

    if (storageErr || !fileBlob) {
      // Резервный поиск в таблице work_scripts, если файл еще не перенесен в Storage
      const { data: dbScript } = await supabaseAdmin
        .from("work_scripts")
        .select("full_script_text")
        .eq("work_id", workId)
        .maybeSingle();

      if (dbScript && dbScript.full_script_text) {
        return new Response(
          JSON.stringify({ 
            success: true, 
            script: dbScript.full_script_text,
            source: "database" 
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: `Скрипт для работы ${workId} не найден в хранилище` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Чтение содержимого файла
    const scriptText = await fileBlob.text();

    // 5. Возврат полного защищенного скрипта
    return new Response(
      JSON.stringify({
        success: true,
        script: scriptText,
        source: "storage",
        workId: workId
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Внутренняя ошибка сервера" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
