// Test script for smart batching implementation
// Load this in browser console to verify batching behavior

console.log('🧪 Smart Batching Test Suite\n');

// Test 1: Verify configuration constants
console.log('📋 Configuration Check:');
console.log('   SYNC_INTERVAL:', window.SYNC_INTERVAL || '(defined in background.js)');
console.log('   Expected: 30000ms (30 seconds)\n');

// Test 2: Monitor batching messages
console.log('📊 Monitoring Phase:');
console.log('   1. Visit different websites');
console.log('   2. Watch for "Batched Xs for domain.com" messages');
console.log('   3. Verify "✅ Flushed" appears every ~30 seconds\n');

// Test 3: Volume-based trigger
console.log('🔢 Volume Trigger Test:');
console.log('   1. Visit 5+ different sites quickly');
console.log('   2. Should see immediate flush\n');

// Test 4: Tab switch trigger
console.log('🔄 Tab Switch Test:');
console.log('   1. Track a site for 10 seconds');
console.log('   2. Switch tabs');
console.log('   3. Should see immediate flush\n');

console.log('✅ Test suite ready. Monitor console output while browsing.\n');
