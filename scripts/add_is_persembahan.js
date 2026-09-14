require('dotenv').config();
const mysql = require('mysql2/promise');
const db = require('../config/db');

async function run() {
  try {
    console.log('--- 1. Updating test DB ---');
    const [colsTest] = await db.query('DESCRIBE t_events');
    const existsTest = colsTest.some(c => c.Field === 'is_persembahan');
    if (!existsTest) {
      await db.query('ALTER TABLE t_events ADD COLUMN is_persembahan TINYINT(1) NOT NULL DEFAULT 0 AFTER is_attendance');
      console.log('Column is_persembahan added to test.t_events');
    } else {
      console.log('Column is_persembahan already exists in test.t_events');
    }
    await db.query("UPDATE t_events SET is_persembahan = 1 WHERE event_type = 'MINGGU'");
    console.log('Updated existing MINGGU events to is_persembahan = 1 in test DB');

    console.log('--- 2. Updating prod DB ---');
    const prodUrl = process.env.DATABASE_URL.replace('/test?', '/erp_church_prod?');
    const prodDb = await mysql.createConnection(prodUrl);
    const [colsProd] = await prodDb.query('DESCRIBE t_events');
    const existsProd = colsProd.some(c => c.Field === 'is_persembahan');
    if (!existsProd) {
      await prodDb.query('ALTER TABLE t_events ADD COLUMN is_persembahan TINYINT(1) NOT NULL DEFAULT 0 AFTER is_attendance');
      console.log('Column is_persembahan added to erp_church_prod.t_events');
    } else {
      console.log('Column is_persembahan already exists in erp_church_prod.t_events');
    }
    await prodDb.query("UPDATE t_events SET is_persembahan = 1 WHERE event_type = 'MINGGU'");
    console.log('Updated existing MINGGU events to is_persembahan = 1 in prod DB');

    await prodDb.end();
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
