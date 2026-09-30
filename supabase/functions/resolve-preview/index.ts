// @ts-nocheck
// Supabase Edge Function: resolve-preview
// Автоматическое получение актуальной прямой ссылки на изображение с ExHentai / E-Hentai по короткой ссылке (/s/...)
// Поддерживает ротацию зеркала Hath (nl), фоллбек на E-Hentai и безопасную обработку редиректов с сохранением Cookie

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Безопасный запрос с сохранением Cookie на всех шагах редиректа
 * Предотвращает сброс заголовка Cookie рантаймом Deno и бесконечный цикл (20 redirects)
 */
async function fetchWithCookies(url: string, headers: Record<string, string>, maxRedirects = 5) {
  let currentUrl = url;
  for (let i = 0; i < maxRedirects; i++) {
    const resp = await fetch(currentUrl, {
      headers,
      redirect: "manual"
    });

    // Успешный ответ или стандартная ошибка (не редирект)
    if (resp.status < 300 || resp.status >= 400) {
      return { resp, finalUrl: currentUrl };
    }

    const location = resp.headers.get("location");
    if (!location) {
      return { resp, finalUrl: currentUrl };
    }

    const nextUrl = new URL(location, currentUrl).toString();

    // Перехват блокировки ExHentai
    if (nextUrl.includes("poni=no")) {
      throw new Error("ExHentai вернул редирект poni=no (отказ в доступе). Убедитесь, что в EX_COOKIES скопированы ipb_member_id, ipb_pass_hash и ОБЯЗАТЕЛЬНО igneous с сайта exhentai.org!");
    }

    console.log(`[resolve-preview] Редирект ${resp.status} с ${currentUrl} -> ${nextUrl}`);
    currentUrl = nextUrl;
  }
  throw new Error(`Превышен лимит редиректов (${maxRedirects})`);
}

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

    // 3. Получаем и очищаем секретные cookie ExHentai из переменных окружения
    const rawCookies = (typeof Deno !== "undefined" && Deno.env) 
      ? (Deno.env.get("EX_COOKIES") || Deno.env.get("EX_COOKIE") || "") 
      : "";
    
    let exCookies = rawCookies.trim();
    if (exCookies.toLowerCase().startsWith("cookie:")) {
      exCookies = exCookies.substring(7).trim();
    }
    exCookies = exCookies.replace(/\r?\n/g, "; ").trim();

    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
      "Cache-Control": forceFresh ? "no-cache" : "max-age=0"
    };

    if (exCookies) {
      headers["Cookie"] = exCookies;
    }

    // 4. Попытка запроса: сначала исходный адрес, при сбое — автоматический переход на зеркало e-hentai
    const targets = [fetchUrl];
    if (fetchUrl.includes("exhentai.org")) {
      targets.push(fetchUrl.replace("exhentai.org", "e-hentai.org"));
    }

    let foundHtml = "";
    let foundImg = "";
    const targetResults: any[] = [];

    for (const target of targets) {
      try {
        console.log(`[resolve-preview] Fetching ${target}`);
        const { resp: pageResp } = await fetchWithCookies(target, headers, 6);

        const status = pageResp.status;
        const text = await pageResp.text();
        const textLen = text.length;

        const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : "";

        // Поиск прямой ссылки на изображение
        const imgMatch = text.match(/<img[^>]+id=["']img["'][^>]+src=["']([^"']+)["']/i) 
                      || text.match(/<img[^>]+src=["']([^"']+)["'][^>]+id=["']img["']/i)
                      || text.match(/src=["'](https?:\/\/[^"']+\.hath\.network[^"']+)["']/i)
                      || text.match(/src=["'](https?:\/\/[^"']+\/h\/[a-f0-9]+-[0-9]+-[0-9]+-[0-9]+-[a-z0-9]+\/[^"']+)["']/i);

        if (imgMatch && imgMatch[1]) {
          foundHtml = text;
          foundImg = imgMatch[1].replace(/&amp;/g, '&');
          break; // Успешно найдено!
        }

        // Если изображение не найдено, классифицируем точную причину
        let reason = `HTTP ${status}`;
        const lower = text.toLowerCase();
        if (lower.includes("sad panda") || lower.includes("sadpanda")) {
          reason = "Sad Panda (ExHentai отклонил доступ — проверьте куку igneous в EX_COOKIES)";
        } else if (lower.includes("viewing limit") || lower.includes("image limit") || lower.includes("exceeded")) {
          reason = "ExHentai Viewing Limit (исчерпан лимит просмотра изображений аккаунта)";
        } else if (lower.includes("temporarily banned") || lower.includes("excessive pageloads") || lower.includes("banned")) {
          reason = "IP Ban (слишком много запросов подряд / бан по IP)";
        } else if (lower.includes("just a moment") || lower.includes("cloudflare") || lower.includes("turnstile")) {
          reason = "Cloudflare Challenge (проверка Cloudflare)";
        } else if (lower.includes("this gallery has been removed") || lower.includes("gallery has been removed") || status === 404) {
          reason = "Галерея удалена или скрыта";
        } else if (title) {
          reason = `Заголовок: "${title}" (HTML: ${textLen} байт)`;
        } else {
          reason = `HTTP ${status}, длина: ${textLen} байт, начало: ${text.slice(0, 120).replace(/\s+/g, ' ')}`;
        }

        targetResults.push({ target, status, reason, title });
      } catch (err: any) {
        targetResults.push({ target, reason: err.message });
      }
    }

    if (!foundImg) {
      const summaryReason = targetResults.map(r => `[${r.target.includes("exhentai") ? "ExHentai" : "E-Hentai"}: ${r.reason}]`).join(" | ");
      console.warn(`[resolve-preview] Не удалось извлечь изображение: ${summaryReason}`);
      return new Response(
        JSON.stringify({ 
          error: summaryReason || "Не удалось получить страницу сцены с ExHentai/E-Hentai",
          details: targetResults 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const imageUrl = foundImg;

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
    console.error("[resolve-preview] Критическая ошибка выполнения функции:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Внутренняя ошибка сервера" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve(handler);
} else {
  const { serve } = await import("https://deno.land/std@0.168.0/http/server.ts");
  serve(handler);
}
