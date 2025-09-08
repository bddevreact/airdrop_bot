#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Helper function to convert date to timestamp
const dateToTimestamp = (dateString) => {
  return Math.floor(new Date(dateString).getTime() / 1000);
};

// Helper function to convert timestamp to readable date
const timestampToDate = (timestamp) => {
  return new Date(timestamp * 1000).toLocaleString();
};

function setPresaleDates() {
  const configPath = path.join(__dirname, 'config.json');
  
  // Read current config
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('❌ Error reading config.json:', e.message);
    return;
  }

  console.log('🎯 $CR7 Airdrop Bot - Presale Date Setter\n');
  
  // Show current dates
  if (config.presaleStart && config.presaleEnd) {
    console.log('📅 Current Presale Dates:');
    console.log(`   Start: ${timestampToDate(config.presaleStart)}`);
    console.log(`   End:   ${timestampToDate(config.presaleEnd)}\n`);
  }

  // Get new dates from command line arguments
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('📝 Usage: node set-presale-dates.js "start-date" "end-date"');
    console.log('📝 Example: node set-presale-dates.js "2025-01-01 00:00:00" "2025-01-06 23:59:59"');
    console.log('📝 Example: node set-presale-dates.js "2025-01-01" "2025-01-06"');
    console.log('\n💡 You can use any date format that JavaScript Date() can understand');
    return;
  }

  const startDate = args[0];
  const endDate = args[1];

  try {
    const startTimestamp = dateToTimestamp(startDate);
    const endTimestamp = dateToTimestamp(endDate);

    if (startTimestamp >= endTimestamp) {
      console.error('❌ Error: Start date must be before end date');
      return;
    }

    // Update config
    config.presaleStart = startTimestamp;
    config.presaleEnd = endTimestamp;

    // Write back to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log('✅ Presale dates updated successfully!');
    console.log(`📅 Start: ${timestampToDate(startTimestamp)}`);
    console.log(`📅 End:   ${timestampToDate(endTimestamp)}`);
    console.log(`⏱️  Duration: ${Math.ceil((endTimestamp - startTimestamp) / 86400)} days`);
    console.log('\n🔄 Restart the bot to apply changes');

  } catch (e) {
    console.error('❌ Error parsing dates:', e.message);
    console.log('\n💡 Try these formats:');
    console.log('   "2025-01-01 00:00:00"');
    console.log('   "January 1, 2025"');
    console.log('   "2025-01-01T00:00:00Z"');
  }
}

// Quick presets
function showPresets() {
  console.log('🚀 Quick Presets:');
  console.log('   node set-presale-dates.js "2025-01-01" "2025-01-07"     # 1 week');
  console.log('   node set-presale-dates.js "2025-01-01" "2025-01-15"     # 2 weeks');
  console.log('   node set-presale-dates.js "2025-01-01" "2025-01-31"     # 1 month');
  console.log('   node set-presale-dates.js "2025-01-01 12:00:00" "2025-01-01 18:00:00"  # 6 hours');
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showPresets();
} else {
  setPresaleDates();
}
