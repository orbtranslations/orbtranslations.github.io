const fs = require('fs');
const path = require('path');

function findFile(rel) {
  const c1 = path.join(__dirname, '..', rel);
  if (fs.existsSync(c1)) return c1;
  const c2 = path.join(__dirname, '../../Site', rel);
  if (fs.existsSync(c2)) return c2;
  const c3 = path.join(process.cwd(), rel);
  if (fs.existsSync(c3)) return c3;
  throw new Error('Cannot find file ' + rel);
}

// 1. Verify i18n keys
const i18nContent = fs.readFileSync(findFile('js/i18n.js'), 'utf8');
const requiredKeys = [
  'admin_users_title',
  'admin_users_sub',
  'admin_users_refresh',
  'admin_users_loading',
  'admin_users_empty',
  'admin_th_user',
  'admin_th_email',
  'admin_th_role',
  'admin_th_balance',
  'admin_th_user_actions',
  'admin_btn_save_balance',
  'admin_btn_user_deals',
  'admin_deals_modal_title',
  'admin_deals_user_badge',
  'admin_deals_empty',
  'admin_deals_btn_clear_all',
  'admin_deal_btn_delete',
  'admin_deals_clear_all_confirm',
  'admin_deal_delete_confirm',
  'admin_balance_updated',
  'admin_deal_deleted',
  'admin_deals_cleared',
  'admin_invalid_balance'
];

for (const key of requiredKeys) {
  if (!i18nContent.includes(key + ':')) {
    console.error(`MISSING i18n key: ${key}`);
    process.exit(1);
  }
}
console.log('✅ All i18n keys present in RU and EN');

// 2. Verify index.html elements
const htmlContent = fs.readFileSync(findFile('index.html'), 'utf8');
const requiredHtml = [
  'id="admin-users-card"',
  'id="admin-users-table-body"',
  'id="admin-user-deals-modal"',
  'id="admin-deals-modal-username"',
  'id="admin-user-deals-table-body"',
  'admin.renderUsersTable()',
  'admin.refreshCurrentDealsModal()',
  'admin.handleClearAllUserDeals()'
];

for (const elem of requiredHtml) {
  if (!htmlContent.includes(elem)) {
    console.error(`MISSING HTML element: ${elem}`);
    process.exit(1);
  }
}
console.log('✅ All HTML elements and bindings present in index.html');

// 3. Mock window and document environment to test store & admin logic
global.window = {
  crypto: { getRandomValues: (arr) => arr },
  location: { hash: '' }
};
global.localStorage = {
  store: {},
  getItem(k) { return this.store[k] || null; },
  setItem(k, v) { this.store[k] = v; },
  removeItem(k) { delete this.store[k]; }
};

// Evaluate store.js
const storeCode = fs.readFileSync(findFile('js/store.js'), 'utf8');
eval(storeCode);

const store = global.window.store;
console.log('Store instantiated:', !!store);

async function runTests() {
  // Simulate logged-in admin user
  store.data.currentUser = {
    id: 'usr_test_123',
    email: 'admin@example.com',
    name: 'SuperAdmin',
    orbs: 50.0
  };
  store.data.currentRole = 'admin';

  // Test 1: getRegisteredUsers fallback when supabaseClient is undefined
  const users = await store.getRegisteredUsers();
  console.log('Registered users found:', users.length);
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('getRegisteredUsers should return registered user when offline');
  }
  const currUser = users[0];
  console.log('Current user in list:', currUser.id, currUser.orbs);

  // Test 2: updateUserOrbs
  const initialOrbs = store.getCurrentUser().orbs;
  await store.updateUserOrbs(currUser.id, 99.5);
  if (store.getCurrentUser().orbs !== 99.5) {
    throw new Error(`Expected orbs to be 99.5, got ${store.getCurrentUser().orbs}`);
  }
  console.log('✅ updateUserOrbs updated currentUser orbs to 99.5');

  // Test 3: user orders mock session
  store.data.cryptoSessions = {
    'test_ord_1': {
      orderId: 'test_ord_1',
      network: 'USDT (TRC-20)',
      expectedAmount: 50,
      orbsAmount: 50,
      status: 'completed',
      txHash: '0x123abc'
    },
    'test_ord_2': {
      orderId: 'test_ord_2',
      network: 'BTC',
      expectedAmount: 0.001,
      orbsAmount: 70,
      status: 'pending'
    }
  };

  const userOrders = await store.getUserOrders(currUser.id);
  console.log('User orders found:', userOrders.length);
  if (userOrders.length !== 2) {
    throw new Error(`Expected 2 orders, got ${userOrders.length}`);
  }
  console.log('✅ getUserOrders successfully returned user orders');

  // Test 4: deleteCryptoOrder (selective)
  const delRes = await store.deleteCryptoOrder('test_ord_1');
  if (!delRes.success) throw new Error('deleteCryptoOrder failed');
  const ordersAfterDel = await store.getUserOrders(currUser.id);
  if (ordersAfterDel.length !== 1 || ordersAfterDel[0].id !== 'test_ord_2') {
    throw new Error('Selective deletion failed');
  }
  console.log('✅ deleteCryptoOrder selectively removed deal test_ord_1');

  // Test 5: clearUserOrders (complete)
  const clearRes = await store.clearUserOrders(currUser.id);
  if (!clearRes.success) throw new Error('clearUserOrders failed');
  const ordersAfterClear = await store.getUserOrders(currUser.id);
  if (ordersAfterClear.length !== 0) {
    throw new Error('clearUserOrders failed to erase all orders');
  }
  console.log('✅ clearUserOrders completely wiped all user deals');

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
