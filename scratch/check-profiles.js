const url = 'https://xbxnjdpkvmwtmkcjkoxe.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhieG5qZHBrdm13dG1rY2prb3hlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMzUxMTcsImV4cCI6MjEwNDcxMTExN30.54k7DJQNCzfVeWbqeqENzefwkvAbzZI5AJ0BE7WdoXE';

async function check() {
  const ordRes = await fetch(`${url}/rest/v1/crypto_orders?id=eq.ORD-173`, {
    headers: {
      'apikey': anonKey,
      'Authorization': `Bearer ${anonKey}`
    }
  });
  const orders = await ordRes.json();
  console.log('ORD-173 exists:', orders.length > 0, orders);
}

check().catch(console.error);

