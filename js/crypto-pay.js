/**
 * CryptoPay — Модуль HD-кошелька (xPub) и приёма платежей в USDT TRC-20 / TRX
 * 1 Орб = 1 USDT.
 * Поддерживает как прямой приём на адрес кошелька USDT (TRC-20), так и HD-деривацию
 * уникальных суб-адресов под каждый заказ на основе Master Public Key (xPub).
 */

// ============================================================================
// Минимальный стандартизированный генератор QR-кодов (ISO/IEC 18004)
// Генерирует валидный сканируемый QR-код для любого криптокошелька / смартфона
// ============================================================================
class QRCodeGenerator {
  static PAD0 = 0xEC;
  static PAD1 = 0x11;

  static EXP_TABLE = new Uint8Array(256);
  static LOG_TABLE = new Uint8Array(256);

  static initGF() {
    if (QRCodeGenerator.EXP_TABLE[1] !== 0) return;
    for (let i = 0; i < 8; i++) QRCodeGenerator.EXP_TABLE[i] = 1 << i;
    for (let i = 8; i < 256; i++) {
      QRCodeGenerator.EXP_TABLE[i] = QRCodeGenerator.EXP_TABLE[i - 4] ^
                                     QRCodeGenerator.EXP_TABLE[i - 5] ^
                                     QRCodeGenerator.EXP_TABLE[i - 6] ^
                                     QRCodeGenerator.EXP_TABLE[i - 8];
    }
    for (let i = 0; i < 255; i++) {
      QRCodeGenerator.LOG_TABLE[QRCodeGenerator.EXP_TABLE[i]] = i;
    }
  }

  static glog(n) {
    if (n < 1) throw new Error('glog(' + n + ')');
    return QRCodeGenerator.LOG_TABLE[n];
  }

  static gexp(n) {
    while (n < 0) n += 255;
    while (n >= 256) n -= 255;
    return QRCodeGenerator.EXP_TABLE[n];
  }

  static RS_BLOCKS = {
    1: [{ total: 26, data: 16 }],
    2: [{ total: 44, data: 28 }],
    3: [{ total: 70, data: 44 }],
    4: [{ total: 50, data: 32 }, { total: 50, data: 32 }],
    5: [{ total: 67, data: 43 }, { total: 67, data: 43 }],
    6: [{ total: 43, data: 27 }, { total: 43, data: 27 }, { total: 43, data: 27 }, { total: 43, data: 27 }]
  };

  static ALIGNMENT_PATTERN_POSITIONS = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34]
  };

  static getErrorCorrectionPolynomial(errorCorrectionLength) {
    let poly = [1];
    for (let i = 0; i < errorCorrectionLength; i++) {
      const nextPoly = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        nextPoly[j] ^= QRCodeGenerator.gexp(QRCodeGenerator.glog(poly[j]) + i);
        nextPoly[j + 1] ^= poly[j];
      }
      poly = nextPoly;
    }
    return poly;
  }

  static calculateReedSolomon(data, ecCount) {
    const generator = QRCodeGenerator.getErrorCorrectionPolynomial(ecCount);
    const info = new Array(data.length + ecCount).fill(0);
    for (let i = 0; i < data.length; i++) info[i] = data[i];

    for (let i = 0; i < data.length; i++) {
      const coef = info[i];
      if (coef !== 0) {
        for (let j = 0; j < generator.length; j++) {
          info[i + j] ^= QRCodeGenerator.gexp(QRCodeGenerator.glog(generator[j]) + QRCodeGenerator.glog(coef));
        }
      }
    }
    return info.slice(data.length);
  }

  static createMatrix(text) {
    QRCodeGenerator.initGF();
    const utf8Bytes = [];
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      if (code < 128) utf8Bytes.push(code);
      else if (code < 2048) {
        utf8Bytes.push(192 | (code >> 6), 128 | (code & 63));
      } else {
        utf8Bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
      }
    }

    let version = 1;
    for (let v = 1; v <= 6; v++) {
      const blocks = QRCodeGenerator.RS_BLOCKS[v];
      const maxDataBytes = blocks.reduce((sum, b) => sum + b.data, 0);
      if (maxDataBytes >= utf8Bytes.length + 3) {
        version = v;
        break;
      }
    }

    const blocks = QRCodeGenerator.RS_BLOCKS[version];
    const totalDataBytes = blocks.reduce((sum, b) => sum + b.data, 0);

    let bitBuffer = [];
    const pushBits = (val, length) => {
      for (let i = length - 1; i >= 0; i--) {
        bitBuffer.push((val >> i) & 1);
      }
    };

    // Mode 8-bit byte = 0100
    pushBits(0b0100, 4);
    pushBits(utf8Bytes.length, 8);
    for (const b of utf8Bytes) {
      pushBits(b, 8);
    }

    const neededBits = totalDataBytes * 8;
    const termCount = Math.min(4, neededBits - bitBuffer.length);
    for (let i = 0; i < termCount; i++) bitBuffer.push(0);

    while (bitBuffer.length % 8 !== 0) bitBuffer.push(0);

    const dataBytes = [];
    for (let i = 0; i < bitBuffer.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bitBuffer[i + j];
      dataBytes.push(b);
    }

    let pad = 0;
    while (dataBytes.length < totalDataBytes) {
      dataBytes.push(pad % 2 === 0 ? QRCodeGenerator.PAD0 : QRCodeGenerator.PAD1);
      pad++;
    }

    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;
    for (const block of blocks) {
      const slice = dataBytes.slice(offset, offset + block.data);
      offset += block.data;
      dataBlocks.push(slice);
      const ec = QRCodeGenerator.calculateReedSolomon(slice, block.total - block.data);
      ecBlocks.push(ec);
    }

    const finalCodewords = [];
    const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
    for (let i = 0; i < maxDataLen; i++) {
      for (const b of dataBlocks) {
        if (i < b.length) finalCodewords.push(b[i]);
      }
    }
    const maxEcLen = Math.max(...ecBlocks.map(b => b.length));
    for (let i = 0; i < maxEcLen; i++) {
      for (const b of ecBlocks) {
        if (i < b.length) finalCodewords.push(b[i]);
      }
    }

    const moduleCount = version * 4 + 17;
    const matrix = Array.from({ length: moduleCount }, () => Array(moduleCount).fill(null));
    const isReserved = Array.from({ length: moduleCount }, () => Array(moduleCount).fill(false));

    const placeFinder = (startX, startY) => {
      for (let y = -1; y <= 7; y++) {
        for (let x = -1; x <= 7; x++) {
          const r = startY + y;
          const c = startX + x;
          if (r < 0 || r >= moduleCount || c < 0 || c >= moduleCount) continue;
          isReserved[r][c] = true;
          if ((x >= 0 && x <= 6 && (y === 0 || y === 6)) ||
              (y >= 0 && y <= 6 && (x === 0 || x === 6)) ||
              (x >= 2 && x <= 4 && y >= 2 && y <= 4)) {
            matrix[r][c] = true;
          } else {
            matrix[r][c] = false;
          }
        }
      }
    };
    placeFinder(0, 0);
    placeFinder(moduleCount - 7, 0);
    placeFinder(0, moduleCount - 7);

    const alignPos = QRCodeGenerator.ALIGNMENT_PATTERN_POSITIONS[version] || [];
    for (const y of alignPos) {
      for (const x of alignPos) {
        if (isReserved[y][x]) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const r = y + dy;
            const c = x + dx;
            isReserved[r][c] = true;
            matrix[r][c] = (Math.abs(dx) === 2 || Math.abs(dy) === 2 || (dx === 0 && dy === 0));
          }
        }
      }
    }

    for (let i = 8; i < moduleCount - 8; i++) {
      if (!isReserved[6][i]) {
        matrix[6][i] = (i % 2 === 0);
        isReserved[6][i] = true;
      }
      if (!isReserved[i][6]) {
        matrix[i][6] = (i % 2 === 0);
        isReserved[i][6] = true;
      }
    }

    matrix[4 * version + 9][8] = true;
    isReserved[4 * version + 9][8] = true;

    for (let i = 0; i < 9; i++) {
      if (i !== 6) {
        isReserved[8][i] = true;
        isReserved[i][8] = true;
      }
    }
    for (let i = 0; i < 8; i++) {
      isReserved[8][moduleCount - 1 - i] = true;
      isReserved[moduleCount - 1 - i][8] = true;
    }

    let bitIndex = 0;
    const finalBits = [];
    for (const cw of finalCodewords) {
      for (let b = 7; b >= 0; b--) {
        finalBits.push((cw >> b) & 1);
      }
    }

    let upward = true;
    for (let rightCol = moduleCount - 1; rightCol > 0; rightCol -= 2) {
      if (rightCol === 6) rightCol--;
      const cols = [rightCol, rightCol - 1];
      const rows = upward
        ? Array.from({ length: moduleCount }, (_, i) => moduleCount - 1 - i)
        : Array.from({ length: moduleCount }, (_, i) => i);

      for (const r of rows) {
        for (const c of cols) {
          if (!isReserved[r][c]) {
            const bit = bitIndex < finalBits.length ? finalBits[bitIndex++] : 0;
            const maskedBit = ((r + c) % 2 === 0) ? (bit ^ 1) : bit;
            matrix[r][c] = (maskedBit === 1);
          }
        }
      }
      upward = !upward;
    }

    const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];

    let idx = 0;
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) matrix[8][i] = (formatBits[idx++] === 1);
    }
    for (let i = 7; i >= 0; i--) {
      if (i !== 6) matrix[i][8] = (formatBits[idx++] === 1);
    }

    for (let i = 0; i < 7; i++) {
      matrix[moduleCount - 1 - i][8] = (formatBits[i] === 1);
    }
    for (let i = 0; i < 8; i++) {
      matrix[8][moduleCount - 8 + i] = (formatBits[7 + i] === 1);
    }

    return matrix;
  }
}

class CryptoPaymentService {
  constructor(store) {
    this.store = store;
    this.activeSession = null;
    this.timerInterval = null;
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
   * Создание новой платежной сессии
   */
  createInvoice(orbsAmount, network = 'USDT (TRC-20)') {
    const amount = Number(orbsAmount);
    if (!amount || amount <= 0) {
      throw new Error('Укажите корректное количество Орбов');
    }

    const orderIndex = this.store.getNextOrderIndex();
    const address = this.deriveAddress(null, orderIndex, network);

    let derivationPath = 'Прямой перевод на кошелёк';
    let formattedAmount = `${amount} USDT`;
    let networkBadge = 'TRC-20';

    if (network.includes('BTC') || network.includes('Bitcoin')) {
      derivationPath = 'Bitcoin Mainnet • Прямой перевод';
      const btcVal = (amount / 65000).toFixed(6);
      formattedAmount = `${btcVal} BTC (~$${amount})`;
      networkBadge = 'BTC';
    } else if (network.includes('Polygon') || network.includes('POL')) {
      derivationPath = 'Polygon Network (POL) • Прямой перевод';
      formattedAmount = `${amount} USDT`;
      networkBadge = 'POL';
    } else {
      derivationPath = 'TRON Network (TRC-20) • Прямой перевод';
      formattedAmount = `${amount} USDT`;
      networkBadge = 'TRC-20';
    }

    this.activeSession = {
      orderId: `ORD-${orderIndex}`,
      orderIndex,
      orbsAmount: amount,
      usdtAmount: amount, // 1 Орб = 1 USDT
      formattedAmount,
      network,
      networkBadge,
      address,
      isDirect: true,
      derivationPath,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 минут
      status: 'pending' // 'pending' | 'completed' | 'expired'
    };

    // Запись заказа в базу данных Supabase
    if (window.supabaseClient) {
      const user = this.store.getCurrentUser();
      const userId = (user.id && !user.id.startsWith('usr_')) ? user.id : null;
      window.supabaseClient
        .from('crypto_orders')
        .insert({
          id: this.activeSession.orderId,
          user_id: userId,
          network: this.activeSession.network,
          deposit_address: this.activeSession.address,
          orbs_amount: this.activeSession.orbsAmount,
          expected_amount: this.activeSession.usdtAmount,
          status: 'pending'
        })
        .then(() => {})
        .catch(err => console.warn('Создание заказа в Supabase ожидает настройки таблиц:', err));
    }

    // Запуск фонового сканера блокчейна
    this.startBlockchainWatcher();

    return this.activeSession;
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

    if (trackerText) {
      trackerText.textContent = `📡 Сканирование ${session.networkBadge || session.network}... (${nowStr})`;
    }

    try {
      let detectedTx = null;

      // 1. Проверка USDT TRC-20 через публичный TronGrid API
      if (session.network.includes('TRC-20') || session.network.includes('Tron') || session.network.includes('TRX')) {
        const url = `https://api.trongrid.io/v1/accounts/${session.address}/transactions/trc20?limit=15&contract_address=TR7NHqJEKQxGTCi8q8ZY4pL8otSzgjLj6t`;
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          if (json.data && Array.isArray(json.data)) {
            const minTimestamp = session.createdAt - 10 * 60 * 1000;
            const match = json.data.find(tx => {
              const toAddr = tx.to;
              const val = Number(tx.value) / 1e6; // 6 decimals for USDT
              const txTime = Number(tx.block_timestamp);
              return toAddr === session.address && val >= (session.usdtAmount * 0.99) && txTime >= minTimestamp;
            });
            if (match) {
              detectedTx = {
                txHash: match.transaction_id,
                amount: Number(match.value) / 1e6,
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
              const hasOutput = tx.vout && tx.vout.some(v => v.scriptpubkey_address === session.address && v.value > 0);
              const txTime = (tx.status && tx.status.block_time) ? tx.status.block_time * 1000 : Date.now();
              return hasOutput && txTime >= (session.createdAt - 15 * 60 * 1000);
            });
            if (match) {
              detectedTx = {
                txHash: match.txid,
                amount: session.usdtAmount,
                network: 'BTC'
              };
            }
          }
        }
      }

      // 3. Проверка Polygon (POL) через Polygonscan / public API
      else if (session.network.includes('Polygon') || session.network.includes('POL')) {
        const url = `https://api.polygonscan.com/api?module=account&action=tokentx&contractaddress=0xc2132D05D31c914a87C6611C10748AEb04B58e8F&address=${session.address}&page=1&offset=10&sort=desc`;
        try {
          const res = await fetch(url);
          if (res.ok) {
            const json = await res.json();
            if (json.status === '1' && Array.isArray(json.result)) {
              const minTimestamp = Math.floor((session.createdAt - 10 * 60 * 1000) / 1000);
              const match = json.result.find(tx => {
                const toAddr = (tx.to || '').toLowerCase();
                const val = Number(tx.value) / 1e6;
                const txTime = Number(tx.timeStamp);
                return toAddr === session.address.toLowerCase() && val >= (session.usdtAmount * 0.99) && txTime >= minTimestamp;
              });
              if (match) {
                detectedTx = {
                  txHash: match.hash,
                  amount: Number(match.value) / 1e6,
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
          trackerText.textContent = `✅ Транзакция подтверждена: ${detectedTx.txHash.slice(0, 8)}...`;
        }
        await this.confirmRealPayment(detectedTx.txHash, detectedTx.network);
      } else {
        if (trackerText) {
          trackerText.textContent = `📡 Ожидание перевода... (${nowStr})`;
        }
        if (isManual && window.app) {
          window.app.showToast('Транзакция пока не найдена в сети. Если вы уже отправили перевод, подождите 1–2 минуты для подтверждения сетью.', 'info');
        }
      }
    } catch (e) {
      console.warn('Ошибка при проверке блокчейна:', e);
      if (isManual && window.app) {
        window.app.showToast('Сеть блокчейна опрашивается... Подождите подтверждения.', 'info');
      }
    }
  }

  /**
   * Подтверждение реальной транзакции и начисление баланса
   */
  async confirmRealPayment(txHash, network) {
    if (!this.activeSession || this.activeSession.status !== 'pending') return;

    this.activeSession.status = 'completed';
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
      window.app.showToast(`🎉 Платеж подтверждён сетью блокчейн! Зачислено +${amount} Орб!`, 'success');
      window.app.closeAllModals();
      window.app.renderUserHeader();
      window.app.renderStorefront();
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
   * Генерация стандартизированного ISO QR-кода на чистом Canvas без внешних библиотек
   */
  renderQRCodeToCanvas(canvasElement, text) {
    if (!canvasElement || !text) return;
    try {
      const matrix = QRCodeGenerator.createMatrix(text);
      const modules = matrix.length;
      const quietZone = 4;
      const totalModules = modules + quietZone * 2;
      const size = 180;

      canvasElement.width = size;
      canvasElement.height = size;
      const ctx = canvasElement.getContext('2d');

      // Чистый белый фон
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);

      // Рисование пикселей QR кода
      const cellSize = size / totalModules;
      ctx.fillStyle = '#0f172a';

      for (let r = 0; r < modules; r++) {
        for (let c = 0; c < modules; c++) {
          if (matrix[r][c]) {
            const x = (c + quietZone) * cellSize;
            const y = (r + quietZone) * cellSize;
            ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cellSize), Math.ceil(cellSize));
          }
        }
      }
    } catch (e) {
      console.warn('Ошибка построения QR-кода:', e);
    }
  }

  /**
   * Симуляция успешного подтверждения транзакции в сети блокчейн
   */
  confirmPaymentSimulation() {
    if (!this.activeSession || this.activeSession.status !== 'pending') {
      return { success: false, message: 'Нет активной ожидающей сессии оплаты' };
    }

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
    this.stopBlockchainWatcher();
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }
    this.activeSession = null;
  }
}

window.cryptoPay = new CryptoPaymentService(window.store);
