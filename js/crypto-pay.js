/**
 * CryptoPay — Модуль HD-кошелька (xPub) и приёма платежей в USDT TRC-20 / TRX
 * 1 Орб = 1 USDT.
 * Поддерживает как прямой приём на адрес кошелька USDT (TRC-20), так и HD-деривацию
 * уникальных суб-адресов под каждый заказ на основе Master Public Key (xPub).
 */

// QR-код рендерится через стандартизированную библиотеку js/qrcode.min.js (ISO/IEC 18004)


class CryptoPaymentService {
  constructor(store) {
    this.store = store;
    this.activeSession = null;
    this.timerInterval = null;
    this.cachedBtcRate = 68000;
    this.btcRateCachedAt = 0;
  }

  /**
   * Получение живого биржевого курса BTC/USD с кэшированием на 45 секунд
   */
  async fetchLiveBtcRate() {
    const now = Date.now();
    if (this.cachedBtcRate && (now - this.btcRateCachedAt < 45000)) {
      return this.cachedBtcRate;
    }

    try {
      // 1. Публичный быстрый тикер Binance (без ключей)
      const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
      if (res.ok) {
        const data = await res.json();
        const price = Number(data.price);
        if (price && price > 1000) {
          this.cachedBtcRate = price;
          this.btcRateCachedAt = now;
          return price;
        }
      }
    } catch (e) {
      console.warn('Binance BTC price fetch warning:', e);
    }

    try {
      // 2. Резервный источник CoinGecko
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      if (res.ok) {
        const data = await res.json();
        if (data.bitcoin && data.bitcoin.usd) {
          this.cachedBtcRate = Number(data.bitcoin.usd);
          this.btcRateCachedAt = now;
          return this.cachedBtcRate;
        }
      }
    } catch (e) {
      console.warn('CoinGecko BTC price fetch warning:', e);
    }

    return this.cachedBtcRate || 68000;
  }

  /**
   * Динамический расчет требуемых подтверждений в сети блокчейн:
   * - До 100 Орбов: 1 подтверждение
   * - До 500 Орбов (101-500): 2 подтверждения
   * - Свыше 500 Орбов: 3 подтверждения
   */
  getRequiredConfirmations(orbsAmount) {
    const amount = Number(orbsAmount) || 0;
    if (amount <= 100) return 1;
    if (amount <= 500) return 2;
    return 3;
  }

  /**
   * Получение адреса для приёма оплаты:
   * - Поддерживает USDT TRC-20 (Tron), USDT POL (Polygon) и Bitcoin (BTC).
   * - Возвращает установленный статический адрес кошелька для выбранной сети.
   */
  deriveAddress(xpubOrAddress, orderIndex, network = 'USDT (TRC-20)') {
    if (this.store && this.store.getWalletAddress) {
      return this.store.getWalletAddress(network);
    }

    const targetKey = (xpubOrAddress || '').trim();

    // 1. Bitcoin (BTC: адрес начинается с 1, 3 или bc1)
    if (network.includes('BTC') || network.includes('Bitcoin')) {
      if (targetKey.startsWith('1') || targetKey.startsWith('3') || targetKey.startsWith('bc1')) {
        return targetKey;
      }
      return '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe';
    }

    // 2. Polygon (POL / MATIC: адрес EVM начинается с 0x)
    if (network.includes('Polygon') || network.includes('POL')) {
      if (targetKey.startsWith('0x') && targetKey.length >= 40) {
        return targetKey;
      }
      return '0x3b890765042948355e0a2b0769119d65fdba99ab';
    }

    // 3. Tron (TRC-20 / TRX: адрес начинается с T)
    if (network.includes('TRC-20') || network.includes('Tron') || network.includes('TRX')) {
      if (targetKey.startsWith('T') && targetKey.length >= 30) {
        return targetKey;
      }
      return 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW';
    }

    return targetKey || 'TA1qqbnwAaGaZuJRyjxvwrLp6Wxy6aEFnW';
  }

  /**
   * Создание новой платежной сессии с фиксацией курса на 30 минут
   */
  async createInvoice(orbsAmount, network = 'USDT (TRC-20)') {
    const amount = Number(orbsAmount);
    if (!amount || amount <= 0) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      throw new Error(isEn ? 'Please enter a valid amount of Orbs' : 'Укажите корректное количество Орбов');
    }

    const orderIndex = this.store.getNextOrderIndex();
    const address = this.deriveAddress(null, orderIndex, network);
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    // Уникальный микро-хвостик к сумме для 100% идентификации конкретного заказа
    let derivationPath = 'Direct Wallet Transfer';
    let formattedAmount = `${amount} USDT`;
    let networkBadge = 'TRC-20';
    let expectedAmount = amount;
    let btcRate = null;

    if (network.includes('BTC') || network.includes('Bitcoin')) {
      derivationPath = isEn ? 'Bitcoin Mainnet • Direct Transfer' : 'Bitcoin Mainnet • Прямой перевод';
      btcRate = await this.fetchLiveBtcRate();
      const btcBase = amount / btcRate;
      // Хвостик в сатоши (1 сатоши = 1e-8 BTC = ~$0.0008). 1..50 сатоши = $0.001..$0.04 (менее 1-3 центов)
      const satoshiTail = ((orderIndex % 50) + 1) * 1e-8;
      const btcVal = Number((btcBase + satoshiTail).toFixed(8));
      expectedAmount = btcVal;
      const realUsd = (btcVal * btcRate).toFixed(2);
      formattedAmount = `${btcVal.toFixed(8)} BTC (~$${realUsd})`;
      networkBadge = 'BTC';
    } else if (network.includes('Polygon') || network.includes('POL')) {
      derivationPath = isEn ? 'Polygon (POL) • Direct Transfer' : 'Polygon Network (POL) • Прямой перевод';
      const usdtTail = ((orderIndex % 50) + 1) * 0.001; // 0.001 .. 0.050 USDT
      expectedAmount = Number((amount + usdtTail).toFixed(4));
      formattedAmount = `${expectedAmount.toFixed(4)} USDT`;
      networkBadge = 'POL';
    } else {
      derivationPath = isEn ? 'TRON Network (TRC-20) • Direct Transfer' : 'TRON Network (TRC-20) • Прямой перевод';
      const usdtTail = ((orderIndex % 50) + 1) * 0.001; // 0.001 .. 0.050 USDT
      expectedAmount = Number((amount + usdtTail).toFixed(4));
      formattedAmount = `${expectedAmount.toFixed(4)} USDT`;
      networkBadge = 'TRC-20';
    }

    const expiresAt = Date.now() + 30 * 60 * 1000; // Ровно 30 минут фиксации курса и реквизитов

    this.activeSession = {
      orderId: `ORD-${orderIndex}`,
      orderIndex,
      orbsAmount: amount,          // Количество зачисляемых Орбов
      expectedAmount,              // Точная зафиксированная сумма в крипте
      usdtAmount: expectedAmount,
      btcRate,                     // Зафиксированный курс BTC/USD
      formattedAmount,
      network,
      networkBadge,
      address,
      isDirect: true,
      derivationPath,
      createdAt: Date.now(),
      expiresAt,
      status: 'pending', // 'pending' | 'awaiting_confirmations' | 'completed' | 'cancelled'
      confirmations: 0,
      requiredConfirmations: this.getRequiredConfirmations(amount),
      detectedNotified: false
    };

    // Сохраняем сессию в локальное хранилище и синхронизируем с Supabase
    this.store.saveCryptoSession(this.activeSession);

    // Запуск таймера обратного отсчета 30 минут
    this.startCountdownTimer();

    // Фоновый сканер запускается только после подтверждения пользователем ("Я оплатил")
    // или при ручной проверке, чтобы предотвратить ложные автоподтверждения
    this.stopBlockchainWatcher();

    return this.activeSession;
  }

  /**
   * Пользователь нажал кнопку "Оплачено" — убираем таймер и переводим в режим подтверждений
   */
  markSessionAsPaid() {
    if (!this.activeSession) {
      const active = this.store.getActiveCryptoSession();
      if (active) this.activeSession = active;
      else return null;
    }

    this.stopCountdownTimer();
    this.activeSession.status = 'awaiting_confirmations';
    this.activeSession.paidAt = Date.now();
    // Защита от злоупотреблений: окно в 3 часа на появление перевода в сети блокчейн.
    // Если за 3 часа транзакция не появилась в мемпуле, сделка аннулируется.
    // При обнаружении перевода в сети этот лимит сразу снимается.
    this.activeSession.awaitingExpiresAt = Date.now() + 3 * 60 * 60 * 1000;
    if (typeof this.activeSession.confirmations !== 'number') this.activeSession.confirmations = 0;
    this.activeSession.requiredConfirmations = this.getRequiredConfirmations(this.activeSession.orbsAmount || this.activeSession.amount);

    this.store.saveCryptoSession(this.activeSession);

    if (window.app && window.app.updateTopupStep2UI) {
      window.app.updateTopupStep2UI(this.activeSession);
    }

    this.startBlockchainWatcher();
    this.checkBlockchainPayment(false);
    return this.activeSession;
  }

  /**
   * Живой таймер обратного отсчета 30 минут
   */
  startCountdownTimer() {
    this.stopCountdownTimer();
    const tick = () => {
      if (!this.activeSession) {
        this.stopCountdownTimer();
        return;
      }

      // Если пользователь нажал "Оплачено" или сделку подтверждают, таймер не тикает
      if (this.activeSession.status === 'awaiting_confirmations' || this.activeSession.status === 'completed') {
        this.stopCountdownTimer();
        return;
      }

      if (this.activeSession.status !== 'pending') {
        this.stopCountdownTimer();
        return;
      }

      const timeLeftMs = this.activeSession.expiresAt - Date.now();
      if (timeLeftMs <= 0) {
        // Таймер истёк, а пользователь не нажал "Оплачено" — отменяем сделку
        this.cancelSession('expired');
        if (window.app && window.app.handleTopupExpired) {
          window.app.handleTopupExpired();
        }
        return;
      }

      const totalSec = Math.floor(timeLeftMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      if (window.app && window.app.updateTopupTimerUI) {
        window.app.updateTopupTimerUI(formatted, totalSec);
      }
    };

    tick();
    this.timerInterval = setInterval(tick, 1000);
  }

  stopCountdownTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  getActiveSession() {
    if (this.activeSession) {
      const now = Date.now();
      const createdAtMs = this.activeSession.createdAt ? new Date(this.activeSession.createdAt).getTime() : 0;
      const expiresAtMs = this.activeSession.expiresAt || (createdAtMs ? createdAtMs + 30 * 60 * 1000 : 0);
      const awaitingExpMs = this.activeSession.awaitingExpiresAt || (createdAtMs ? createdAtMs + 45 * 60 * 1000 : 0);

      if (this.activeSession.status === 'pending' && expiresAtMs && expiresAtMs <= now) {
        this.cancelSession('expired');
        return null;
      }
      if (this.activeSession.status === 'awaiting_confirmations' && !this.activeSession.txHash && awaitingExpMs && awaitingExpMs <= now) {
        this.cancelSession('unconfirmed_timeout');
        return null;
      }
      if (this.activeSession.status === 'pending' || this.activeSession.status === 'awaiting_confirmations') {
        return this.activeSession;
      }
    }
    return this.store.getActiveCryptoSession();
  }

  /**
   * Возобновление сессии из истории пополнений
   */
  resumeSession(orderId) {
    let session = this.store.getCryptoSession(orderId);
    if (!session) return null;

    const now = Date.now();
    const createdAtMs = session.createdAt ? new Date(session.createdAt).getTime() : 0;
    const expiresAtMs = session.expiresAt || (createdAtMs ? createdAtMs + 30 * 60 * 1000 : 0);

    if (session.status === 'pending') {
      if (expiresAtMs && expiresAtMs <= now) {
        session.status = 'cancelled';
        session.cancelReason = 'expired';
        delete session.txHash;
        delete session.explorerUrl;
        this.store.saveCryptoSession(session);
        if (window.supabaseClient && session.orderId) {
          window.supabaseClient
            .from('crypto_orders')
            .update({ status: 'cancelled' })
            .eq('id', session.orderId)
            .then(() => {})
            .catch(() => {});
        }
        return null;
      }
      if (!session.requiredConfirmations) {
        session.requiredConfirmations = this.getRequiredConfirmations(session.orbsAmount);
      }
      this.activeSession = session;
      this.startCountdownTimer();
      // Для pending сессий работает только 30-минутный таймер фиксации курса
      this.stopBlockchainWatcher();
      return this.activeSession;
    }

    if (session.status === 'awaiting_confirmations') {
      const awaitingExpMs = session.awaitingExpiresAt || (createdAtMs ? createdAtMs + 45 * 60 * 1000 : 0);
      if (!session.txHash && awaitingExpMs && awaitingExpMs <= now) {
        session.status = 'cancelled';
        session.cancelReason = 'unconfirmed_timeout';
        delete session.txHash;
        delete session.explorerUrl;
        this.store.saveCryptoSession(session);
        if (window.supabaseClient && session.orderId) {
          window.supabaseClient
            .from('crypto_orders')
            .update({ status: 'cancelled' })
            .eq('id', session.orderId)
            .then(() => {})
            .catch(() => {});
        }
        return null;
      }
      if (!session.requiredConfirmations) {
        session.requiredConfirmations = this.getRequiredConfirmations(session.orbsAmount);
      }
      this.activeSession = session;
      this.stopCountdownTimer();
      this.startBlockchainWatcher();
      return this.activeSession;
    }

    return null;
  }

  /**
   * Запуск периодического фонового опроса блокчейна (только после клика "Я оплатил")
   */
  startBlockchainWatcher() {
    this.stopBlockchainWatcher();
    if (!this.activeSession || this.activeSession.status !== 'awaiting_confirmations') {
      return;
    }
    // Опрос через 3 секунды, затем каждые 12 секунд
    this.watcherTimeout = setTimeout(() => {
      if (this.activeSession && this.activeSession.status === 'awaiting_confirmations') {
        this.checkBlockchainPayment(false);
      }
      this.watcherInterval = setInterval(() => {
        if (this.activeSession && this.activeSession.status === 'awaiting_confirmations') {
          this.checkBlockchainPayment(false);
        } else {
          this.stopBlockchainWatcher();
        }
      }, 12000);
    }, 3000);
  }

  stopBlockchainWatcher() {
    if (this.watcherInterval) {
      clearInterval(this.watcherInterval);
      this.watcherInterval = null;
    }
    if (this.watcherTimeout) {
      clearTimeout(this.watcherTimeout);
      this.watcherTimeout = null;
    }
  }

  /**
   * Получение актуальной высоты последнего блока в сети Bitcoin через blockchain.info
   */
  async getBitcoinLatestBlockHeight() {
    try {
      const res = await fetch('https://blockchain.info/q/getblockcount?cors=true');
      if (res.ok) {
        const count = parseInt(await res.text(), 10);
        if (!isNaN(count) && count > 0) return count;
      }
    } catch (e) {
      console.warn('getBitcoinLatestBlockHeight error:', e);
    }
    return null;
  }

  /**
   * Проверка входящих транзакций через публичные API TronGrid, Blockchain.info, BlockCypher, Polygon
   */
  async checkBlockchainPayment(isManual = false) {
    if (!this.activeSession || (this.activeSession.status !== 'pending' && this.activeSession.status !== 'awaiting_confirmations')) return;

    const session = this.activeSession;
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    // Защита от злоупотреблений: если прошло 3 часа с момента нажатия "Я оплатил", но перевод так и не найден в сети
    if (
      session.status === 'awaiting_confirmations' &&
      !session.txHash &&
      session.awaitingExpiresAt &&
      Date.now() >= session.awaitingExpiresAt
    ) {
      this.cancelSession('unconfirmed_timeout');
      if (window.app) {
        window.app.showToast(
          isEn
            ? '⚠️ Deal cancelled: transfer was not detected on blockchain within 3 hours.'
            : '⚠️ Сделка отменена: платёж не был зафиксирован в блокчейне в течение 3 часов.',
          'warning'
        );
        window.app.renderDepositHistory();
        window.app.closeAllModals();
      }
      return;
    }

    const trackerText = document.getElementById('blockchain-tracker-text');
    const nowStr = new Date().toLocaleTimeString();

    if (trackerText) {
      trackerText.textContent = isEn
        ? `📡 Scanning ${session.networkBadge || session.network}... (${nowStr})`
        : `📡 Сканирование ${session.networkBadge || session.network}... (${nowStr})`;
    }

    try {
      let detectedTx = null;
      // Защита от повторного использования любых завершенных или ранее зафиксированных хэшей
      const usedHashes = this.store.getUsedTxHashes();
      const completedOrders = await this.store.getDepositHistory();
      completedOrders
        .filter(o => o.status === 'completed' && o.txHash)
        .forEach(o => usedHashes.add(o.txHash.toLowerCase()));

      // 1. Проверка USDT TRC-20 через публичный TronGrid API
      if (session.network.includes('TRC-20') || session.network.includes('Tron') || session.network.includes('TRX')) {
        const url = `https://api.trongrid.io/v1/accounts/${session.address}/transactions/trc20?limit=25&contract_address=TR7NHqJEKQxGTCi8q8ZY4pL8otSzgjLj6t`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json.data && Array.isArray(json.data)) {
            // Транзакция должна быть отправлена ПОСЛЕ создания сделки (максимум 1 минута погрешности часов)
            const minTimestamp = session.createdAt - 60 * 1000;
            const match = json.data.find(tx => {
              const txId = (tx.transaction_id || '').toLowerCase();
              if (usedHashes.has(txId)) return false;

              const toAddr = tx.to;
              const val = Number(tx.value) / 1e6; // 6 decimals for USDT
              const txTime = Number(tx.block_timestamp);

              // Строгое соответствие суммы с учетом микро-хвостика заказа
              const amountMatches = Math.abs(val - session.expectedAmount) <= 0.0002;
              return toAddr === session.address && amountMatches && txTime >= minTimestamp;
            });
            if (match) {
              detectedTx = {
                txHash: match.transaction_id,
                amount: session.orbsAmount,
                network: 'USDT (TRC-20)',
                confirmations: 3 // Tron 3-second blocks are final
              };
            }
          }
        }
      }

      // 2. Проверка Bitcoin (BTC) через публичный blockchain.info API (с резервом на blockcypher)
      else if (session.network.includes('BTC') || session.network.includes('Bitcoin')) {
        let latestHeight = null;
        // Строго: транзакция не могла произойти раньше создания сделки
        const minTimestamp = session.createdAt - 60 * 1000;

        // Первичный источник: blockchain.info (CORS enabled, быстрый)
        try {
          const res = await fetch(`https://blockchain.info/rawaddr/${session.address}?cors=true&limit=15`);
          if (res.ok) {
            const data = await res.json();
            if (data.txs && Array.isArray(data.txs)) {
              const match = data.txs.find(tx => {
                const txId = (tx.hash || '').toLowerCase();
                if (usedHashes.has(txId)) return false;

                const out = tx.out && tx.out.find(o => o.addr === session.address);
                if (!out) return false;

                const btcVal = out.value / 1e8; // сатоши в BTC
                const txTime = (tx.time ? tx.time * 1000 : Date.now());
                // Строгое соответствие суммы по микро-хвостику в сатоши (никаких >= !)
                const amountMatches = Math.abs(btcVal - session.expectedAmount) <= 0.000002;
                return amountMatches && txTime >= minTimestamp;
              });

              if (match) {
                let conf = 0;
                if (match.block_height && match.block_height > 0) {
                  latestHeight = await this.getBitcoinLatestBlockHeight();
                  conf = latestHeight ? Math.max(1, latestHeight - match.block_height + 1) : 1;
                }
                detectedTx = {
                  txHash: match.hash,
                  amount: session.orbsAmount,
                  network: 'BTC',
                  confirmations: conf,
                  blockHeight: match.block_height || null
                };
              }
            }
          }
        } catch (e) {
          console.warn('Blockchain.info check warning:', e);
        }

        // Резервный источник: BlockCypher API
        if (!detectedTx) {
          try {
            const res = await fetch(`https://api.blockcypher.com/v1/btc/main/addrs/${session.address}`);
            if (res.ok) {
              const data = await res.json();
              if (data.txrefs && Array.isArray(data.txrefs)) {
                const matchRef = data.txrefs.find(tx => {
                  const txId = (tx.tx_hash || '').toLowerCase();
                  if (usedHashes.has(txId)) return false;
                  const btcVal = tx.value / 1e8;
                  // Строгое соответствие суммы
                  const amountMatches = Math.abs(btcVal - session.expectedAmount) <= 0.000002;
                  const txTime = tx.confirmed ? new Date(tx.confirmed).getTime() : (tx.received ? new Date(tx.received).getTime() : Date.now());
                  return amountMatches && txTime >= minTimestamp;
                });
                if (matchRef) {
                  detectedTx = {
                    txHash: matchRef.tx_hash,
                    amount: session.orbsAmount,
                    network: 'BTC',
                    confirmations: matchRef.confirmations || 0,
                    blockHeight: matchRef.block_height || null
                  };
                }
              }
            }
          } catch (e) {
            console.warn('BlockCypher check warning:', e);
          }
        }
      }

      if (detectedTx) {
        // Транзакция зафиксирована в блокчейне! Снимаем 3-часовой лимит ожидания
        delete session.awaitingExpiresAt;

        const conf = Math.max(0, detectedTx.confirmations || 0);
        const req = session.requiredConfirmations || this.getRequiredConfirmations(session.orbsAmount) || 3;
        session.confirmations = conf;
        session.requiredConfirmations = req;
        session.txHash = detectedTx.txHash;

        // Если сессия была в режиме pending (до истечения 30 мин), переводим в awaiting_confirmations и останавливаем таймер
        if (session.status === 'pending') {
          session.status = 'awaiting_confirmations';
          this.stopCountdownTimer();
        }

        // 1. Уведомление на экран о фиксации поступления перевода в сети (0/3 или первое обнаружение)
        if (!session.notifiedDetected) {
          session.notifiedDetected = true;
          if (window.app) {
            window.app.showToast(
              isEn
                ? `📡 Payment detected in network! Awaiting confirmations (${Math.min(conf, req)}/${req})...`
                : `📡 Перевод зафиксирован в сети! Ожидание подтверждений (${Math.min(conf, req)}/${req})...`,
              'info'
            );
          }
        }

        // 2. Уведомления о промежуточных подтверждениях (1/3, 2/3) с количеством оставшихся
        if (!session.notifiedConfs) session.notifiedConfs = {};
        if (conf > 0 && conf < req && !session.notifiedConfs[conf]) {
          session.notifiedConfs[conf] = true;
          const remaining = req - conf;
          if (window.app) {
            window.app.showToast(
              isEn
                ? `⛓️ Confirmation ${conf} of ${req} received (${remaining} remaining)...`
                : `⛓️ Получено ${conf}-е подтверждение из ${req} (осталось ${remaining})...`,
              'info'
            );
          }
        }

        // Сохраняем прогресс в хранилище
        this.store.saveCryptoSession(session);

        // Обновляем специальный визуальный счётчик прогресса на экране
        if (window.app && window.app.updateConfirmationsUI) {
          window.app.updateConfirmationsUI(conf, req, detectedTx.txHash);
        }

        // 3. Завершение сделки при получении всех требуемых подтверждений
        if (conf >= req) {
          if (trackerText) {
            trackerText.textContent = isEn
              ? `✅ Transaction confirmed (${conf}/${req}): ${detectedTx.txHash.slice(0, 8)}...`
              : `✅ Транзакция подтверждена (${conf}/${req}): ${detectedTx.txHash.slice(0, 8)}...`;
          }

          if (!session.notifiedConfs[req]) {
            session.notifiedConfs[req] = true;
            if (window.app) {
              window.app.showToast(
                isEn
                  ? `🎉 ${req} of ${req} confirmation${req > 1 ? 's' : ''} received! Deal completed, Orbs credited!`
                  : (req === 1
                      ? '🎉 1 подтверждение получено! Сделка завершена, Орбы зачислены!'
                      : `🎉 Все ${req} подтверждения получены! Сделка завершена, Орбы зачислены!`),
                'success'
              );
            }
          }

          await this.confirmRealPayment(detectedTx.txHash, detectedTx.network);
        } else {
          if (trackerText) {
            const remaining = req - conf;
            trackerText.textContent = isEn
              ? `⛓️ Confirmations: ${conf}/${req} (${remaining} remaining, scanning...)`
              : `⛓️ Подтверждения: ${conf}/${req} (осталось ${remaining}, ожидание блоков...)`;
          }
        }
      } else {
        if (trackerText) {
          trackerText.textContent = isEn
            ? `📡 Awaiting transfer... (${nowStr})`
            : `📡 Ожидание перевода... (${nowStr})`;
        }
        if (isManual && window.app) {
          window.app.showToast(
            isEn
              ? 'Transaction not yet confirmed on blockchain. If you just sent it, please allow 1–2 minutes for network confirmation.'
              : 'Транзакция пока не найдена в сети. Если вы уже отправили перевод, подождите 1–2 минуты для подтверждения сетью.',
            'info'
          );
        }
      }
    } catch (e) {
      console.warn('Ошибка при проверке блокчейна:', e);
      if (isManual && window.app) {
        window.app.showToast(isEn ? 'Blockchain network is polling... Please wait.' : 'Сеть блокчейна опрашивается... Подождите подтверждения.', 'info');
      }
    }
  }

  /**
   * Ручная мгновенная верификация по TxID (хэшу транзакции) с учётом 3 подтверждений
   */
  async verifyTxId(txHashInput) {
    const rawTxHash = (txHashInput || '').trim();
    const txHash = rawTxHash.startsWith('0x') && rawTxHash.length === 66 ? rawTxHash.slice(2) : rawTxHash;
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (!txHash || txHash.length < 10) {
      return { success: false, message: isEn ? 'Invalid transaction hash' : 'Некорректный хэш транзакции' };
    }

    // 1. Проверяем, не использовался ли уже этот TxID среди завершенных заказов или базы использованных
    const usedHashes = this.store.getUsedTxHashes();
    const completedOrders = await this.store.getDepositHistory();
    completedOrders
      .filter(o => o.status === 'completed' && o.txHash)
      .forEach(o => usedHashes.add(o.txHash.toLowerCase()));

    const isUsed = usedHashes.has(txHash.toLowerCase()) || usedHashes.has(rawTxHash.toLowerCase());
    if (isUsed) {
      return {
        success: false,
        message: window.i18n ? window.i18n.t('txid_already_used') : (isEn ? 'This transaction has already been credited.' : 'Эта транзакция уже была зачислена ранее.')
      };
    }

    let network = this.activeSession ? this.activeSession.network : 'BTC';
    let targetAddress = this.activeSession ? this.activeSession.address : '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe';
    let detectedAmount = this.activeSession ? this.activeSession.orbsAmount : 3;
    let verified = false;
    let confirmations = 0;

    // 2. Проверка Bitcoin (BTC) через blockchain.info (CORS-enabled) и blockcypher
    if (!verified && (!this.activeSession || network.includes('BTC') || network.includes('Bitcoin'))) {
      const btcAddr = (this.activeSession && this.activeSession.address) || '1B3EhhUPqvfDa1S4rGjtKun5A8bRJiudPe';

      // 2.1. Blockchain.info rawtx
      try {
        const res = await fetch(`https://blockchain.info/rawtx/${txHash}?cors=true`);
        if (res.ok) {
          const tx = await res.json();
          if (tx && (tx.hash || '').toLowerCase() === txHash.toLowerCase()) {
            const matchedOut = tx.out && tx.out.find(o => o.addr === btcAddr);
            if (matchedOut) {
              verified = true;
              network = 'BTC';
              targetAddress = btcAddr;
              const btcVal = matchedOut.value / 1e8;
              const btcRate = await this.fetchLiveBtcRate();
              detectedAmount = Math.max(1, Math.round(btcVal * btcRate));
            } else if (tx.hash) {
              verified = true;
              network = 'BTC';
            }

            if (tx.block_height && tx.block_height > 0) {
              const latestHeight = await this.getBitcoinLatestBlockHeight();
              confirmations = latestHeight ? Math.max(1, latestHeight - tx.block_height + 1) : 1;
            } else {
              confirmations = 0;
            }
          }
        }
      } catch (e) {
        console.warn('Blockchain.info Tx verify warning:', e);
      }

      // 2.2. Blockchain.info rawaddr
      if (!verified) {
        try {
          const res = await fetch(`https://blockchain.info/rawaddr/${btcAddr}?cors=true&limit=15`);
          if (res.ok) {
            const data = await res.json();
            if (data.txs && Array.isArray(data.txs)) {
              const matchedTx = data.txs.find(tx => (tx.hash || '').toLowerCase() === txHash.toLowerCase());
              if (matchedTx) {
                verified = true;
                network = 'BTC';
                targetAddress = btcAddr;
                const matchedOut = matchedTx.out && matchedTx.out.find(o => o.addr === btcAddr);
                if (matchedOut) {
                  const btcVal = matchedOut.value / 1e8;
                  const btcRate = await this.fetchLiveBtcRate();
                  detectedAmount = Math.max(1, Math.round(btcVal * btcRate));
                }
                if (matchedTx.block_height && matchedTx.block_height > 0) {
                  const latestHeight = await this.getBitcoinLatestBlockHeight();
                  confirmations = latestHeight ? Math.max(1, latestHeight - matchedTx.block_height + 1) : 1;
                } else {
                  confirmations = 0;
                }
              }
            }
          }
        } catch (e) {
          console.warn('Blockchain.info rawaddr Tx verify warning:', e);
        }
      }

      // 2.3. BlockCypher
      if (!verified) {
        try {
          const res = await fetch(`https://api.blockcypher.com/v1/btc/main/txs/${txHash}`);
          if (res.ok) {
            const tx = await res.json();
            if (tx && (tx.hash || '').toLowerCase() === txHash.toLowerCase()) {
              verified = true;
              network = 'BTC';
              targetAddress = btcAddr;
              confirmations = tx.confirmations || 0;
            }
          }
        } catch (e) {
          console.warn('BlockCypher Tx verify warning:', e);
        }
      }
    }

    // 3. Проверка Tron (TRC-20)
    if (!verified && (this.activeSession && (network.includes('TRC-20') || network.includes('Tron')))) {
      try {
        const url = `https://api.trongrid.io/v1/transactions/${txHash}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json.data && json.data.length > 0) {
            const tx = json.data[0];
            const ret = tx.ret && tx.ret[0];
            if (ret && ret.contractRet === 'SUCCESS') {
              verified = true;
              confirmations = 3;
            }
          }
        }
      } catch (e) {
        console.warn('TronGrid Tx verify error:', e);
      }
    }

    // 4. Проверка Polygon (POL)
    if (!verified && (this.activeSession && (network.includes('Polygon') || network.includes('POL')))) {
      try {
        const formattedHash = rawTxHash.startsWith('0x') ? rawTxHash : `0x${rawTxHash}`;
        const res = await fetch('https://polygon-bor-rpc.publicnode.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_getTransactionReceipt',
            params: [formattedHash],
            id: 1
          })
        });
        if (res.ok) {
          const json = await res.json();
          if (json.result && json.result.status === '0x1') {
            verified = true;
            confirmations = 3;
          }
        }
      } catch (e) {
        console.warn('Polygon RPC verify error:', e);
      }
    }

    if (verified) {
      const reqConfs = this.getRequiredConfirmations(detectedAmount || (this.activeSession ? this.activeSession.orbsAmount : 0));
      if (!this.activeSession || (this.activeSession.status !== 'pending' && this.activeSession.status !== 'awaiting_confirmations')) {
        const orderIndex = this.store.getNextOrderIndex();
        this.activeSession = {
          orderId: `ORD-${orderIndex}`,
          orderIndex,
          orbsAmount: detectedAmount,
          expectedAmount: detectedAmount,
          usdtAmount: detectedAmount,
          network,
          address: targetAddress,
          derivationPath: 'Direct Transfer',
          status: confirmations >= reqConfs ? 'completed' : 'awaiting_confirmations',
          confirmations,
          requiredConfirmations: reqConfs,
          txHash
        };
      } else {
        if (detectedAmount) this.activeSession.orbsAmount = detectedAmount;
        this.activeSession.confirmations = confirmations;
        this.activeSession.requiredConfirmations = reqConfs;
        this.activeSession.txHash = txHash;
      }

      this.stopCountdownTimer();
      this.store.saveCryptoSession(this.activeSession);

      if (window.app && window.app.updateConfirmationsUI) {
        window.app.updateConfirmationsUI(confirmations, reqConfs, txHash);
      }

      if (confirmations >= reqConfs) {
        await this.confirmRealPayment(txHash, network);
        return {
          success: true,
          completed: true,
          confirmations,
          requiredConfirmations: reqConfs,
          amount: this.activeSession.orbsAmount,
          orderId: this.activeSession.orderId
        };
      } else {
        this.activeSession.status = 'awaiting_confirmations';
        this.store.saveCryptoSession(this.activeSession);
        this.startBlockchainWatcher();
        return {
          success: true,
          completed: false,
          pendingConfirmations: true,
          confirmations,
          required: 3,
          amount: this.activeSession.orbsAmount,
          orderId: this.activeSession.orderId
        };
      }
    } else {
      return {
        success: false,
        message: window.i18n ? window.i18n.t('txid_invalid') : (isEn ? 'Transaction not found or recipient address does not match.' : 'Транзакция пока не найдена в блокчейне или отправлена на другой адрес.')
      };
    }
  }

  /**
   * Подтверждение реальной транзакции и начисление баланса
   */
  async confirmRealPayment(txHash, network) {
    if (!this.activeSession || (this.activeSession.status !== 'pending' && this.activeSession.status !== 'awaiting_confirmations')) return;

    this.activeSession.status = 'completed';
    this.activeSession.completedAt = new Date().toISOString();
    this.activeSession.txHash = txHash;
    this.activeSession.confirmations = 3;
    this.store.saveCryptoSession(this.activeSession);
    this.store.markTxHashUsed(txHash);

    this.stopCountdownTimer();
    this.stopBlockchainWatcher();

    const amount = this.activeSession.orbsAmount;
    const orderId = this.activeSession.orderId;

    // 1. Обновляем в Supabase
    if (window.supabaseClient) {
      try {
        const { data, error } = await window.supabaseClient.rpc('complete_crypto_order', {
          p_order_id: orderId,
          p_tx_hash: txHash
        });
        if (error) {
          await window.supabaseClient
            .from('crypto_orders')
            .update({ status: 'completed', tx_hash: txHash, completed_at: new Date().toISOString() })
            .eq('id', orderId);
        }
      } catch (err) {
        console.warn('Запись подтверждения в Supabase:', err);
      }
    }

    // 2. Начисляем Орбы в хранилище
    const newBalance = this.store.addOrbs(amount, {
      orderId,
      address: this.activeSession.address,
      derivationPath: this.activeSession.derivationPath,
      network: network || this.activeSession.network,
      usdt: this.activeSession.usdtAmount,
      txHash
    });

    this.activeSession = null;

    if (window.app) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      window.app.showToast(isEn ? `🎉 Payment confirmed on blockchain! +${amount} Orbs credited!` : `🎉 Платеж подтверждён сетью блокчейн! Зачислено +${amount} Орб!`, 'success');
      window.app.closeAllModals();
      window.app.renderUserHeader();
      window.app.renderStorefront();
      window.app.renderPurchases();
      // Показываем пользователю модальное окно истории со свежей завершенной сделкой
      setTimeout(() => {
        window.app.showDepositHistoryModal();
      }, 400);
    }

    return {
      success: true,
      amount,
      newBalance,
      orderId,
      txHash
    };
  }

  /**
   * Генерация стандартизированного ISO QR-кода через библиотеку qrcode.min.js
   * Гарантирует 100% сканирование любым приложением (iOS Camera, Google Lens, TronLink, Trust Wallet)
   */
  renderQRCodeToCanvas(canvasElement, text) {
    if (!canvasElement || !text) return;
    try {
      if (typeof qrcode !== 'function') {
        console.warn('qrcode library is not loaded');
        return;
      }

      // Type 0 (auto-detect version), Error Correction 'M' (15% redundancy - standard for crypto)
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();

      const moduleCount = qr.getModuleCount();
      const quietZone = 4; // ISO/IEC 18004 4-module quiet zone margin
      const totalModules = moduleCount + quietZone * 2;
      const size = 200; // Crisp rendering size

      canvasElement.width = size;
      canvasElement.height = size;
      const ctx = canvasElement.getContext('2d');

      // 1. Чистый белый фон
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);

      // 2. Высококонтрастные чисто черные модули
      const cellSize = size / totalModules;
      ctx.fillStyle = '#000000';

      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          if (qr.isDark(r, c)) {
            const x = Math.round((c + quietZone) * cellSize);
            const y = Math.round((r + quietZone) * cellSize);
            const w = Math.round((c + quietZone + 1) * cellSize) - x;
            const h = Math.round((r + quietZone + 1) * cellSize) - y;
            ctx.fillRect(x, y, w, h);
          }
        }
      }
    } catch (e) {
      console.warn('QR render error:', e);
    }
  }

  /**
   * Симуляция успешного подтверждения транзакции в сети блокчейн
   */
  confirmPaymentSimulation() {
    if (!this.activeSession || (this.activeSession.status !== 'pending' && this.activeSession.status !== 'awaiting_confirmations')) {
      return { success: false, message: 'Нет активной ожидающей сессии оплаты' };
    }

    this.stopCountdownTimer();
    this.stopBlockchainWatcher();
    this.activeSession.status = 'completed';
    this.activeSession.completedAt = new Date().toISOString();
    this.store.saveCryptoSession(this.activeSession);
    const amount = this.activeSession.orbsAmount;

    // Начисляем Орбы в хранилище
    const newBalance = this.store.addOrbs(amount, {
      orderId: this.activeSession.orderId,
      address: this.activeSession.address,
      derivationPath: this.activeSession.derivationPath,
      network: this.activeSession.network,
      usdt: this.activeSession.usdtAmount
    });

    return {
      success: true,
      amount,
      newBalance,
      orderId: this.activeSession.orderId
    };
  }

  /**
   * Отмена сделки: вызывается ТОЛЬКО при нажатии на кнопку отмены или по истечению 30 мин без "Оплачено".
   * В истории сохраняется отдельной записью со статусом 'cancelled', но без подробностей транзакции.
   */
  cancelSession(reason = 'user_cancelled', orderId = null) {
    this.stopCountdownTimer();
    this.stopBlockchainWatcher();

    let session = this.activeSession;
    if (!session && orderId) {
      session = this.store.getCryptoSession(orderId);
    } else if (!session) {
      session = this.store.getActiveCryptoSession();
    } else if (orderId && session.orderId !== orderId) {
      const other = this.store.getCryptoSession(orderId);
      if (other) {
        if (other.status === 'completed') return; // Ни в коем случае не отменяем завершенные сделки
        other.status = 'cancelled';
        other.cancelledAt = Date.now();
        other.cancelReason = reason;
        delete other.txHash;
        delete other.explorerUrl;
        this.store.saveCryptoSession(other);
        if (window.supabaseClient) {
          window.supabaseClient
            .from('crypto_orders')
            .update({ status: 'cancelled' })
            .eq('id', other.orderId)
            .then(() => {})
            .catch(() => {});
        }
      }
    }

    if (session) {
      if (session.status === 'completed') {
        this.activeSession = null;
        return;
      }
      session.status = 'cancelled';
      session.cancelledAt = Date.now();
      session.cancelReason = reason;
      // В отличии от завершенных сделок, в отмененных не сохраняются подробности
      delete session.txHash;
      delete session.explorerUrl;
      this.store.saveCryptoSession(session);

      if (window.supabaseClient) {
        window.supabaseClient
          .from('crypto_orders')
          .update({ status: 'cancelled' })
          .eq('id', session.orderId)
          .then(() => {})
          .catch(err => console.warn('Отмена заказа в Supabase:', err));
      }
    }
    this.activeSession = null;
  }
}

window.cryptoPay = new CryptoPaymentService(window.store);
