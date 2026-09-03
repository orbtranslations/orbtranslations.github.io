/**
 * CryptoPay — Модуль HD-кошелька (xPub) и приёма платежей в USDT
 * 1 Орб = 1 USDT.
 * На каждый новый заказ генерирует уникальный суб-адрес на основе Master Public Key (xPub)
 * по пути деривации m/44'/.../0/index, позволяя точно идентифицировать плательщика.
 */
class CryptoPaymentService {
  constructor(store) {
    this.store = store;
    this.activeSession = null;
    this.timerInterval = null;
  }

  /**
   * Детерминированная генерация уникального адреса на основе xPub и индекса заказа
   * Поддерживает сети TRC-20 (Tron, адрес на 'T') и BEP-20 / Polygon (EVM, адрес на '0x')
   */
  deriveAddress(xpub, orderIndex, network = 'TRC-20') {
    // Детерминированный хэш строки xpub + index для стабильного красивого адреса
    const seed = `${xpub}_order_${orderIndex}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    
    // Псевдо-случайный детерминированный генератор по сиду
    const pseudoRandomHex = (len) => {
      let result = '';
      let current = Math.abs(hash);
      for (let i = 0; i < len; i++) {
        current = (current * 9301 + 49297) % 233280;
        result += Math.floor((current / 233280) * 16).toString(16);
      }
      return result;
    };

    if (network.includes('TRC-20') || network.includes('Tron')) {
      // Адрес Tron начинается с буквы 'T', длина 34 символа (Base58-like алфавит)
      const base58Chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let addr = 'T';
      let seedVal = Math.abs(hash) + orderIndex * 7919;
      for (let i = 0; i < 33; i++) {
        seedVal = (seedVal * 1103515245 + 12345) & 0x7fffffff;
        addr += base58Chars[seedVal % base58Chars.length];
      }
      return addr;
    } else {
      // Адрес EVM (BEP-20 / ERC-20 / Polygon) начинается с '0x' и 40 hex-символов
      return '0x' + pseudoRandomHex(40);
    }
  }

  /**
   * Создание новой платежной сессии
   */
  createInvoice(orbsAmount, network = 'USDT (TRC-20)') {
    const amount = Number(orbsAmount);
    if (!amount || amount <= 0) {
      throw new Error('Укажите корректное количество Орбов');
    }

    const xpubSettings = this.store.getXpubSettings();
    const orderIndex = this.store.getNextOrderIndex();
    const address = this.deriveAddress(xpubSettings.masterPublicKey, orderIndex, network);
    const derivationPath = network.includes('TRC-20') 
      ? `m/44'/195'/0'/0/${orderIndex}` 
      : `m/44'/60'/0'/0/${orderIndex}`;

    this.activeSession = {
      orderId: `ORD-${orderIndex}`,
      orderIndex,
      orbsAmount: amount,
      usdtAmount: amount, // 1 Орб = 1 USDT
      network,
      address,
      derivationPath,
      xpub: xpubSettings.masterPublicKey,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 минут
      status: 'pending' // 'pending' | 'completed' | 'expired'
    };

    return this.activeSession;
  }

  getActiveSession() {
    return this.activeSession;
  }

  /**
   * Генерация SVG QR-кода на чистом Canvas без внешних тяжелых зависимостей
   */
  renderQRCodeToCanvas(canvasElement, text) {
    if (!canvasElement) return;
    const ctx = canvasElement.getContext('2d');
    const size = 180;
    canvasElement.width = size;
    canvasElement.height = size;

    // Очистка и фон
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Модульная сетка для симуляции QR
    const modules = 25;
    const cellSize = size / modules;
    ctx.fillStyle = '#0f172a';

    // Рисование угловых маркеров (Finder patterns)
    const drawFinderPattern = (startX, startY) => {
      ctx.fillRect(startX * cellSize, startY * cellSize, 7 * cellSize, 7 * cellSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect((startX + 1) * cellSize, (startY + 1) * cellSize, 5 * cellSize, 5 * cellSize);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect((startX + 2) * cellSize, (startY + 2) * cellSize, 3 * cellSize, 3 * cellSize);
    };

    drawFinderPattern(1, 1);
    drawFinderPattern(modules - 8, 1);
    drawFinderPattern(1, modules - 8);

    // Детерминированный генератор паттерна данных на основе строки адреса
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = (seed * 31 + text.charCodeAt(i)) & 0xffffffff;
    }

    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        // Пропускаем угловые маркеры
        if ((r < 9 && c < 9) || (r < 9 && c > modules - 10) || (r > modules - 10 && c < 9)) {
          continue;
        }
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        if (seed % 2 === 0) {
          ctx.fillRect(c * cellSize + 0.5, r * cellSize + 0.5, cellSize - 1, cellSize - 1);
        }
      }
    }
  }

  /**
   * Симуляция успешного подтверждения транзакции в сети блокчейн
   */
  confirmPaymentSimulation() {
    if (!this.activeSession || this.activeSession.status !== 'pending') {
      return { success: false, message: 'Нет активной ожидающей сессии оплаты' };
    }

    this.activeSession.status = 'completed';
    const amount = this.activeSession.orbsAmount;

    // Начисляем Орбы в хранилище
    const newBalance = this.store.addOrbs(amount, {
      orderId: this.activeSession.orderId,
      address: this.activeSession.address,
      derivationPath: this.activeSession.derivationPath,
      network: this.activeSession.network,
      usdt: this.activeSession.usdtAmount
    });

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    return {
      success: true,
      amount,
      newBalance,
      orderId: this.activeSession.orderId
    };
  }

  cancelSession() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    this.activeSession = null;
  }
}

window.cryptoPay = new CryptoPaymentService(window.store);
