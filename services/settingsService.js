'use strict';

const crypto  = require('crypto');
const { query } = require('../db/db');

// Cache so we don't hit DB on every EA request
let _eaKeyCache = null;

/**
 * Get a setting value by key
 */
async function getSetting(key) {
  const res = await query(`SELECT value FROM app_settings WHERE key=$1`, [key]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

/**
 * Set a setting value
 */
async function setSetting(key, value) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1,$2,NOW())
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
    [key, value]
  );
}

/**
 * Get the EA API key — auto-generates one if it doesn't exist yet
 */
async function getEAKey() {
  if (_eaKeyCache) return _eaKeyCache;
  let key = await getSetting('ea_api_key');
  if (!key) {
    key = generateKey();
    await setSetting('ea_api_key', key);
    console.log('✓ EA API key auto-generated and stored in database');
  }
  _eaKeyCache = key;
  return key;
}

/**
 * Regenerate the EA API key (admin only)
 */
async function regenerateEAKey() {
  const key = generateKey();
  await setSetting('ea_api_key', key);
  _eaKeyCache = key; // Update cache
  return key;
}

/**
 * Check if initial setup is needed (no users exist)
 */
async function isSetupRequired() {
  const res = await query(`SELECT COUNT(*) AS count FROM users`);
  return parseInt(res.rows[0].count) === 0;
}

function generateKey() {
  return crypto.randomBytes(32).toString('hex'); // 64-char hex string
}

module.exports = { getSetting, setSetting, getEAKey, regenerateEAKey, isSetupRequired };
