// @ts-nocheck
// Supabase Edge Function: resolve-preview
// Автоматическое получение актуальной прямой ссылки на изображение с ExHentai / E-Hentai по короткой ссылке (/s/...)
// Поддерживает ротацию и обновление ссылки при истечении срока действия (keystamp) или сбое Hath-ноды

declare const Deno: any;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  // 1. CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }
    const { url, nl, forceFresh = false } = body;

    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ error: "Параметр url обязателен" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanUrl = url.trim();
    if (!cleanUrl.includes("/s/")) {
      return new Response(
        JSON.stringify({ error: "Ссылка должна быть ссылкой на страницу просмотра (/s/...)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Формируем URL с учетом кода сбоя ноды (nl), если запрошено обновление
    let fetchUrl = cleanUrl;
    if (nl) {
      const sep = fetchUrl.includes("?") ? "&" : "?";
      fetchUrl = `${fetchUrl}${sep}nl=${encodeURIComponent(nl)}`;
    }

    // 3. Получаем секретные cookie ExHentai из переменных окружения
    const rawCookies = Deno.env.get("EX_COOKIES") || Deno.env.get("EX_COOKIE") || "";
    const exCookies = rawCookies.replace(/\r?\n/g, "; ").trim();

    // 4. Запрос к странице новеллы/манги на ExHentai / E-Hentai
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
      "Cache-Control": forceFresh ? "no-cache" : "max-age=0"
    };

    if (exCookies) {
      headers["Cookie"] = exCookies;
    }

    const pageResp = await fetch(fetchUrl, { headers });

    if (!pageResp.ok) {
      return new Response(
        JSON.stringify({ 
          error: `Ошибка запроса к источнику: HTTP ${pageResp.status} ${pageResp.statusText}` 
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const html = await pageResp.text();

    // 5. Проверка на Sad Panda или пустой ответ
    if (html.includes("sadpanda.jpg") || html.includes("Sad Panda") || html.length < 500) {
      return new Response(
        JSON.stringify({ 
          error: "ExHentai вернул Sad Panda. Убедитесь, что в Supabase Secrets задан валидный EX_COOKIES (ipb_member_id, ipb_pass_hash, igneous)." 
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Извлечение прямой ссылки на изображение из тега <img id="img" src="...">
    const imgMatch = html.match(/<img[^>]+id=["']img["'][^>]+src=["']([^"']+)["']/i) 
                  || html.match(/<img[^>]+src=["']([^"']+)["'][^>]+id=["']img["']/i);

    if (!imgMatch || !imgMatch[1]) {
      return new Response(
        JSON.stringify({ error: "Не удалось найти изображение <img id='img'> на странице" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const imageUrl = imgMatch[1].replace(/&amp;/g, '&');

    // Извлекаем failover ключ nl(...) для случая, если нода Hath недоступна
    const nlMatch = html.match(/nl\(['"]([^'"]+)['"]\)/i) || html.match(/[?&]nl=([^&"']+)/i);
    const failoverNl = nlMatch ? nlMatch[1] : null;

    // Извлекаем имя файла (если есть в описании страницы #i2)
    const nameMatch = html.match(/<div[^>]*>([a-zA-Z0-9_\-\.]+\.(?:jpg|png|webp|jpeg))\s*::/i);
    const fileName = nameMatch ? nameMatch[1] : "";

    return new Response(
      JSON.stringify({
        success: true,
        imageUrl: imageUrl,
        nl: failoverNl,
        fileName: fileName,
        sourceUrl: cleanUrl,
        resolvedAt: Date.now()
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
