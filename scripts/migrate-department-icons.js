/**
 * scripts/migrate-department-icons.js
 * Migrates legacy emoji values in Department.icon to Reicon icon keys.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const M = require('../models');

const EMOJI_TO_KEY = {
  '🏛️': 'building2',
  '🏛': 'building2',
  '💻': 'laptop',
  '📡': 'radio',
  '⚙️': 'settings',
  '⚙': 'settings',
  '⚡': 'bolt',
  '🏗️': 'tower',
  '🏗': 'tower',
  '🖥️': 'monitor',
  '🖥': 'monitor',
  '🤖': 'microchip',
  '🎨': 'palette'
};

const CODE_TO_KEY = {
  'cs': 'laptop',
  'cse': 'laptop',
  'ece': 'radio',
  'mech': 'settings',
  'me': 'settings',
  'eee': 'bolt',
  'ee': 'bolt',
  'civil': 'tower',
  'ce': 'tower',
  'it': 'monitor',
  'aiml': 'microchip',
  'ai': 'microchip',
  'csd': 'palette'
};

const dns = require('dns');
try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
} catch (e) {}

const cfg = require('../config');

async function migrate() {
  console.log(`Connecting to MongoDB (${cfg.DB_NAME})...`);
  await mongoose.connect(cfg.MONGO_URI, {
    dbName: cfg.DB_NAME,
    serverSelectionTimeoutMS: 15000
  });

  const depts = await M.Department.find();
  console.log(`Found ${depts.length} departments to inspect.`);

  let updatedCount = 0;
  for (const dept of depts) {
    let newIcon = null;
    const currentIcon = (dept.icon || '').trim();

    if (EMOJI_TO_KEY[currentIcon]) {
      newIcon = EMOJI_TO_KEY[currentIcon];
    } else {
      const code = (dept.twoLetterCode || dept.code || '').toLowerCase().trim();
      if (CODE_TO_KEY[code]) {
        newIcon = CODE_TO_KEY[code];
      } else if (!currentIcon || currentIcon === '🏛️') {
        newIcon = 'building2';
      }
    }

    if (newIcon && newIcon !== dept.icon) {
      console.log(`Updating ${dept.name} (${dept.code}): '${dept.icon}' -> '${newIcon}'`);
      dept.icon = newIcon;
      await dept.save();
      updatedCount++;
    }
  }

  console.log(`Migration complete. Updated ${updatedCount} departments.`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
