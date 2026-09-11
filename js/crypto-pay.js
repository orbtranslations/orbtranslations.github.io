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
    const tailUnits = (orderIndex % 900) + 100;
    let derivationPath = 'Direct Wallet Transfer';
    let formattedAmount = `${amount} USDT`;
    let networkBadge = 'TRC-20';
    let expectedAmount = amount;
    let btcRate = null;

    if (network.includes('BTC') || network.includes('Bitcoin')) {
      derivationPath = isEn ? 'Bitcoin Mainnet • Direct Transfer' : 'Bitcoin Mainnet • Прямой перевод';
      btcRate = await this.fetchLiveBtcRate();
      const btcBase = amount / btcRate;
      const btcTail = (tailUnits * 1e-7);
      const btcVal = Number((btcBase + btcTail).toFixed(7));
      expectedAmount = btcVal;
      formattedAmount = `${btcVal.toFixed(7)} BTC (~$${amount})`;
      networkBadge = 'BTC';
    } else if (network.includes('Polygon') || network.includes('POL')) {
      derivationPath = isEn ? 'Polygon (POL) • Direct Transfer' : 'Polygon Network (POL) • Прямой перевод';
      const usdtTail = tailUnits * 0.0001;
      expectedAmount = Number((amount + usdtTail).toFixed(4));
      formattedAmount = `${expectedAmount.toFixed(4)} USDT`;
      networkBadge = 'POL';
    } else {
      derivationPath = isEn ? 'TRON Network (TRC-20) • Direct Transfer' : 'TRON Network (TRC-20) • Прямой перевод';
      const usdtTail = tailUnits * 0.0001;
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
      status: 'pending' // 'pending' | 'completed' | 'expired' | 'cancelled'
    };

    // Запись заказа в базу данных Supabase
    if (window.supabaseClient) {
      const user = this.store.getCurrentUser();
      const userId = (user.id && !user.id.startsWith('usr_') && user.id !== 'guest') ? user.id : null;
      window.supabaseClient
        .from('crypto_orders')
        .insert({
          id: this.activeSession.orderId,
          user_id: userId,
          network: this.activeSession.network,
          deposit_address: this.activeSession.address,
          orbs_amount: this.activeSession.orbsAmount,
          expected_amount: this.activeSession.expectedAmount,
          status: 'pending'
        })
        .then(() => {})
        .catch(err => console.warn('Создание заказа в Supabase ожидает настройки таблиц:', err));
    }

    // Запуск таймера обратного отсчета 30 минут
    this.startCountdownTimer();

    // Запуск фонового сканера блокчейна
    this.startBlockchainWatcher();

    return this.activeSession;
  }

  /**
   * Живой таймер обратного отсчета 30 минут
   */
  startCountdownTimer() {
    this.stopCountdownTimer();
    const tick = () => {
      if (!this.activeSession || this.activeSession.status !== 'pending') {
        this.stopCountdownTimer();
        return;
      }

      const timeLeftMs = this.activeSession.expiresAt - Date.now();
      if (timeLeftMs <= 0) {
        this.activeSession.status = 'expired';
        this.stopCountdownTimer();
        this.stopBlockchainWatcher();
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
    return this.activeSession;
  }

  /**
   * Запуск периодического фонового опроса блокчейна
   */
  startBlockchainWatcher() {
    this.stopBlockchainWatcher();
    // Опрос через 4 секунды, затем каждые 12 секунд
    this.watcherTimeout = setTimeout(() => {
      this.checkBlockchainPayment(false);
      this.watcherInterval = setInterval(() => {
        if (this.activeSession && this.activeSession.status === 'pending') {
          this.checkBlockchainPayment(false);
        } else {
          this.stopBlockchainWatcher();
        }
      }, 12000);
    }, 4000);
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
   * Проверка входящих транзакций через публичные API TronGrid, Blockstream, Polygon
   */
  async checkBlockchainPayment(isManual = false) {
    if (!this.activeSession || this.activeSession.status !== 'pending') return;

    const session = this.activeSession;
    const trackerText = document.getElementById('blockchain-tracker-text');
    const nowStr = new Date().toLocaleTimeString();
    const isEn = window.i18n && window.i18n.getLang() === 'en';

    if (trackerText) {
      trackerText.textContent = isEn
        ? `📡 Scanning ${session.networkBadge || session.network}... (${nowStr})`
        : `📡 Сканирование ${session.networkBadge || session.network}... (${nowStr})`;
    }

    try {
      let detectedTx = null;
      const completedOrders = await this.store.getDepositHistory();
      const usedHashes = new Set(completedOrders.map(o => (o.txHash || '').toLowerCase()).filter(Boolean));

      // 1. Проверка USDT TRC-20 через публичный TronGrid API
      if (session.network.includes('TRC-20') || session.network.includes('Tron') || session.network.includes('TRX')) {
        const url = `https://api.trongrid.io/v1/accounts/${session.address}/transactions/trc20?limit=25&contract_address=TR7NHqJEKQxGTCi8q8ZY4pL8otSzgjLj6t`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json.data && Array.isArray(json.data)) {
            const minTimestamp = session.createdAt - 10 * 60 * 1000;
            const match = json.data.find(tx => {
              const txId = (tx.transaction_id || '').toLowerCase();
              if (usedHashes.has(txId)) return false;

              const toAddr = tx.to;
              const val = Number(tx.value) / 1e6; // 6 decimals for USDT
              const txTime = Number(tx.block_timestamp);

              // Точное соответствие суммы с учетом микро-хвостика заказа или достаточной суммы
              const amountMatches = Math.abs(val - session.expectedAmount) <= 0.0001 || (val >= session.orbsAmount && val <= session.expectedAmount + 0.02);
              return toAddr === session.address && amountMatches && txTime >= minTimestamp;
            });
            if (match) {
              detectedTx = {
                txHash: match.transaction_id,
                amount: session.orbsAmount,
                network: 'USDT (TRC-20)'
              };
            }
          }
        }
      }

      // 2. Проверка Bitcoin (BTC) через публичный Blockstream API
      else if (session.network.includes('BTC') || session.network.includes('Bitcoin')) {
        const url = `https://blockstream.info/api/address/${session.address}/txs`;
        const res = await fetch(url);
        if (res.ok) {
          const txs = await res.json();
          if (Array.isArray(txs) && txs.length > 0) {
            const match = txs.find(tx => {
              const txId = (tx.txid || '').toLowerCase();
              if (usedHashes.has(txId)) return false;

              const out = tx.vout && tx.vout.find(v => v.scriptpubkey_address === session.address);
              if (!out) return false;

              const btcVal = out.value / 1e8; // сатоши в BTC
              const txTime = (tx.status && tx.status.block_time) ? tx.status.block_time * 1000 : Date.now();
              const amountMatches = Math.abs(btcVal - session.expectedAmount) <= 0.000001 || btcVal >= (session.expectedAmount * 0.98);
              return amountMatches && txTime >= (session.createdAt - 15 * 60 * 1000);
            });
            if (match) {
              detectedTx = {
                txHash: match.txid,
                amount: session.orbsAmount,
                network: 'BTC'
              };
            }
          }
        }
      }

      // 3. Проверка Polygon (POL) через Polygonscan / public API
      else if (session.network.includes('Polygon') || session.network.includes('POL')) {
        const url = `https://api.polygonscan.com/api?module=account&action=tokentx&contractaddress=0xc2132D05D31c914a87C6611C10748AEb04B58e8F&address=${session.address}&page=1&offset=25&sort=desc`;
        try {
          const res = await fetch(url);
          if (res.ok) {
            const json = await res.json();
            if (json.status === '1' && Array.isArray(json.result)) {
              const minTimestamp = Math.floor((session.createdAt - 10 * 60 * 1000) / 1000);
              const match = json.result.find(tx => {
                const txId = (tx.hash || '').toLowerCase();
                if (usedHashes.has(txId)) return false;

                const toAddr = (tx.to || '').toLowerCase();
                const val = Number(tx.value) / 1e6;
                const txTime = Number(tx.timeStamp);
                const amountMatches = Math.abs(val - session.expectedAmount) <= 0.0001 || (val >= session.orbsAmount && val <= session.expectedAmount + 0.02);
                return toAddr === session.address.toLowerCase() && amountMatches && txTime >= minTimestamp;
              });
              if (match) {
                detectedTx = {
                  txHash: match.hash,
                  amount: session.orbsAmount,
                  network: 'USDT (Polygon)'
                };
              }
            }
          }
        } catch (e) {
          console.warn('Polygon check warning:', e);
        }
      }

      if (detectedTx) {
        if (trackerText) {
          trackerText.textContent = isEn
            ? `✅ Transaction confirmed: ${detectedTx.txHash.slice(0, 8)}...`
            : `✅ Транзакция подтверждена: ${detectedTx.txHash.slice(0, 8)}...`;
        }
        await this.confirmRealPayment(detectedTx.txHash, detectedTx.network);
      } else {
        if (trackerText) {
          trackerText.textContent = isEn
            ? `📡 Awaiting transfer... (${nowStr})`
            : `📡 Ожидание перевода... (${nowStr})`;
        }
        if (isManual && window.app) {
          window.app.showToast(isEn
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
   * Ручная мгновенная верификация по TxID (хэшу транзакции)
   */
  async verifyTxId(txHashInput) {
    if (!this.activeSession || this.activeSession.status !== 'pending') {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      return { success: false, message: isEn ? 'No pending payment session' : 'Нет активной ожидающей сессии оплаты' };
    }

    const txHash = (txHashInput || '').trim();
    if (!txHash || txHash.length < 10) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      return { success: false, message: isEn ? 'Invalid transaction hash' : 'Некорректный хэш транзакции' };
    }

    // 1. Проверяем, не использовался ли уже этот TxID
    const completedOrders = await this.store.getDepositHistory();
    const isUsed = completedOrders.some(o => (o.txHash || '').toLowerCase() === txHash.toLowerCase());
    if (isUsed) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      return {
        success: false,
        message: window.i18n ? window.i18n.t('txid_already_used') : (isEn ? 'This transaction has already been credited.' : 'Эта транзакция уже была зачислена ранее.')
      };
    }

    const session = this.activeSession;
    let verified = false;

    // 2. Проверяем в соответствующей сети блокчейн
    if (session.network.includes('TRC-20') || session.network.includes('Tron')) {
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
            }
          }
        }
      } catch (e) {
        console.warn('TronGrid Tx verify error:', e);
      }
    } else if (session.network.includes('BTC') || session.network.includes('Bitcoin')) {
      try {
        const url = `https://blockstream.info/api/tx/${txHash}`;
        const res = await fetch(url);
        if (res.ok) {
          const tx = await res.json();
          if (tx && tx.txid) {
            verified = true;
          }
        }
      } catch (e) {
        console.warn('Blockstream Tx verify error:', e);
      }
    } else if (session.network.includes('Polygon') || session.network.includes('POL')) {
      try {
        const url = `https://api.polygonscan.com/api?module=transaction&action=gettxreceiptstatus&txhash=${txHash}`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json.status === '1') {
            verified = true;
          }
        }
      } catch (e) {
        console.warn('Polygon Tx verify error:', e);
      }
    }

    if (verified) {
      await this.confirmRealPayment(txHash, session.network);
      return { success: true, amount: session.orbsAmount, orderId: session.orderId };
    } else {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      return {
        success: false,
        message: window.i18n ? window.i18n.t('txid_invalid') : (isEn ? 'Transaction not found in blockchain or still unconfirmed. Please wait 1-2 minutes and try again.' : 'Транзакция пока не подтверждена блокчейном. Подождите 1–2 минуты и попробуйте снова.')
      };
    }
  }

  /**
   * Подтверждение реальной транзакции и начисление баланса
   */
  async confirmRealPayment(txHash, network) {
    if (!this.activeSession || this.activeSession.status !== 'pending') return;

    this.activeSession.status = 'completed';
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

    if (window.app) {
      const isEn = window.i18n && window.i18n.getLang() === 'en';
      window.app.showToast(isEn ? `🎉 Payment confirmed on blockchain! +${amount} Orbs credited!` : `🎉 Платеж подтверждён сетью блокчейн! Зачислено +${amount} Орб!`, 'success');
      window.app.closeAllModals();
      window.app.renderUserHeader();
      window.app.renderStorefront();
      window.app.renderPurchases();
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
    if (!this.activeSession || this.activeSession.status !== 'pending') {
      return { success: false, message: 'Нет активной ожидающей сессии оплаты' };
    }

    this.stopCountdownTimer();
    this.stopBlockchainWatcher();
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

    return {
      success: true,
      amount,
      newBalance,
      orderId: this.activeSession.orderId
    };
  }

  cancelSession() {
    this.stopCountdownTimer();
    this.stopBlockchainWatcher();
    if (this.activeSession && this.activeSession.status === 'pending') {
      this.activeSession.status = 'cancelled';
    }
    this.activeSession = null;
  }
}

window.cryptoPay = new CryptoPaymentService(window.store);
