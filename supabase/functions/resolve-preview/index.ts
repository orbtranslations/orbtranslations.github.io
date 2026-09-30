// @ts-nocheck
// Supabase Edge Function: resolve-preview
// Автоматическое получение актуальной прямой ссылки на изображение с ExHentai / E-Hentai по короткой ссылке (/s/...)
// Поддерживает ротацию зеркала Hath (nl), фоллбек на E-Hentai и защиту от циклов редиректа

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const handler = async (req: Request): Promise<Response> => {
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
    const rawCookies = (typeof Deno !== "undefined" && Deno.env) 
      ? (Deno.env.get("EX_COOKIES") || Deno.env.get("EX_COOKIE") || "") 
      : "";
    const exCookies = rawCookies.replace(/\r?\n/g, "; ").trim();

    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
      "Cache-Control": forceFresh ? "no-cache" : "max-age=0"
    };

    if (exCookies) {
      headers["Cookie"] = exCookies;
    }

    // 4. Попытка запроса: сначала исходный адрес (ExHentai), с автоматическим фоллбеком на зеркало E-Hentai
    const targets = [fetchUrl];
    if (fetchUrl.includes("exhentai.org")) {
      targets.push(fetchUrl.replace("exhentai.org", "e-hentai.org"));
    }

    let foundHtml = "";
    let lastError = "";

    for (const target of targets) {
      try {
        console.log(`[resolve-preview] Fetching ${target}`);
        const pageResp = await fetch(target, {
          headers,
          redirect: "follow"
        });

        if (!pageResp.ok) {
          lastError = `HTTP ${pageResp.status} ${pageResp.statusText}`;
          continue;
        }

        const text = await pageResp.text();

        // Проверка на Sad Panda или бесконечный редирект poni=no
        if (text.includes("sadpanda.jpg") || text.includes("Sad Panda") || (text.length < 1000 && text.includes("poni=no"))) {
          lastError = "ExHentai вернул Sad Panda / poni=no. Проверьте актуальность кук EX_COOKIES в Supabase Secrets.";
          continue;
        }

        const imgMatch = text.match(/<img[^>]+id=["']img["'][^>]+src=["']([^"']+)["']/i) 
                      || text.match(/<img[^>]+src=["']([^"']+)["'][^>]+id=["']img["']/i);

        if (imgMatch && imgMatch[1]) {
          foundHtml = text;
          break; // Успешно найдено
        }
      } catch (err: any) {
        lastError = `Ошибка запроса к ${target}: ${err.message}`;
        console.warn(lastError);
      }
    }

    if (!foundHtml) {
      return new Response(
        JSON.stringify({ error: lastError || "Не удалось получить страницу сцены с ExHentai/E-Hentai" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Извлечение прямой ссылки на изображение из тега <img id="img" src="...">
    const imgMatch = foundHtml.match(/<img[^>]+id=["']img["'][^>]+src=["']([^"']+)["']/i) 
                  || foundHtml.match(/<img[^>]+src=["']([^"']+)["'][^>]+id=["']img["']/i);

    if (!imgMatch || !imgMatch[1]) {
      return new Response(
        JSON.stringify({ error: "Не удалось найти изображение <img id='img'> на странице" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const imageUrl = imgMatch[1].replace(/&amp;/g, '&');

    // Извлекаем failover ключ nl(...) для случая, если нода Hath недоступна
    const nlMatch = foundHtml.match(/nl\(['"]([^'"]+)['"]\)/i) || foundHtml.match(/[?&]nl=([^&"']+)/i);
    const failoverNl = nlMatch ? nlMatch[1] : null;

    // Извлекаем имя файла (если есть в описании страницы #i2)
    const nameMatch = foundHtml.match(/<div[^>]*>([a-zA-Z0-9_\-\.]+\.(?:jpg|png|webp|jpeg))\s*::/i);
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
    console.error("[resolve-preview] Ошибка выполнения функции:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Внутренняя ошибка сервера" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

// Запуск сервера в зависимости от среды Supabase
if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(handler);
} else {
  const { serve } = await import("https://deno.land/std@0.168.0/http/server.ts");
  serve(handler);
}
