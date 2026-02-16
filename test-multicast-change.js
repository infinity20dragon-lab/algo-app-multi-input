/**
 * Test script for multicast IP change + reload + polling verification
 *
 * Testing on zone2 (mcast.zone2) but production will use zone1 (mcast.zone1)
 */

const DEVICE_IP = "10.1.10.179";
const PASSWORD = "algo";
const TEST_ZONE = "mcast.zone2";  // Change to "mcast.zone1" for production
const ACTIVE_IP = "224.0.2.60:5003";   // Active/normal operation
const IDLE_IP = "224.0.2.60:50033";    // Idle mode (not in use)
const MAX_POLL_ATTEMPTS = 20;
const POLL_DELAY_MS = 500;

async function setSetting(setting, value) {
  const url = `http://${DEVICE_IP}/api/settings`;
  const auth = Buffer.from(`admin:${PASSWORD}`).toString('base64');

  console.log(`📝 Setting ${setting} = ${value}`);

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ [setting]: value })
  });

  if (!response.ok) {
    throw new Error(`Failed to set ${setting}: ${response.status} ${response.statusText}`);
  }

  console.log(`✅ Setting updated`);
}

async function reloadDevice() {
  const url = `http://${DEVICE_IP}/api/controls/reload`;
  const auth = Buffer.from(`admin:${PASSWORD}`).toString('base64');

  console.log(`🔄 Reloading device...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to reload: ${response.status} ${response.statusText}`);
  }

  console.log(`✅ Reload command sent`);
}

async function getSetting(setting) {
  const url = `http://${DEVICE_IP}/api/settings/${setting}`;
  const auth = Buffer.from(`admin:${PASSWORD}`).toString('base64');

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to get ${setting}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data[setting];
}

async function pollUntilVerified(setting, expectedValue) {
  console.log(`🔍 Polling to verify ${setting} = ${expectedValue}...`);

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, POLL_DELAY_MS));

    const currentValue = await getSetting(setting);
    console.log(`   Attempt ${attempt}/${MAX_POLL_ATTEMPTS}: ${currentValue}`);

    if (currentValue === expectedValue) {
      console.log(`✅ VERIFIED! ${setting} = ${expectedValue}`);
      return true;
    }
  }

  console.log(`❌ FAILED! Value did not change after ${MAX_POLL_ATTEMPTS} attempts (${MAX_POLL_ATTEMPTS * POLL_DELAY_MS / 1000}s)`);
  return false;
}

async function testMulticastChange(targetIP, mode) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${mode.toUpperCase()} mode: ${targetIP}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Step 1: Change setting
    await setSetting(TEST_ZONE, targetIP);

    // Step 2: Reload device
    await reloadDevice();

    // Step 3: Poll to verify
    const verified = await pollUntilVerified(TEST_ZONE, targetIP);

    if (verified) {
      console.log(`\n🎉 ${mode.toUpperCase()} mode test PASSED!\n`);
      return true;
    } else {
      console.log(`\n⚠️  ${mode.toUpperCase()} mode test FAILED!\n`);
      return false;
    }
  } catch (error) {
    console.error(`\n❌ ERROR in ${mode} mode:`, error.message, '\n');
    return false;
  }
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  Multicast IP Change Test Script                          ║
║  Testing: ${TEST_ZONE} on ${DEVICE_IP}                  ║
╚════════════════════════════════════════════════════════════╝
  `);

  // Get initial value
  console.log(`📊 Checking current value...`);
  const initialValue = await getSetting(TEST_ZONE);
  console.log(`   Current: ${initialValue}\n`);

  // Test 1: Change to ACTIVE mode
  const activeSuccess = await testMulticastChange(ACTIVE_IP, 'active');

  if (!activeSuccess) {
    console.log(`Stopping tests due to failure.`);
    process.exit(1);
  }

  // Wait a bit between tests
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 2: Change to IDLE mode (restore)
  const idleSuccess = await testMulticastChange(IDLE_IP, 'idle');

  if (!idleSuccess) {
    console.log(`Stopping tests due to failure.`);
    process.exit(1);
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║  ✅ ALL TESTS PASSED!                                      ║
║                                                            ║
║  The multicast IP change + reload + polling approach      ║
║  works perfectly. Ready for production use on zone1!      ║
╚════════════════════════════════════════════════════════════╝
  `);
}

// Run the test
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
