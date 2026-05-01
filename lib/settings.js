'use strict';
const { query } = require('./db');
const crypto = require('crypto');
async function getSetting(key) { const r = await query('SELECT value FROM app_settings WHERE key=$1',[key]); return r.rows[0]?.value||null; }
async function setSetting(key,value) { await query(`INSERT INTO app_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2,updated_at=NOW()`,[key,value]); }
async function getEAKey() { let k=await getSetting('ea_api_key'); if(!k){k=crypto.randomBytes(32).toString('hex');await setSetting('ea_api_key',k);} return k; }
async function regenerateEAKey() { const k=crypto.randomBytes(32).toString('hex'); await setSetting('ea_api_key',k); return k; }
module.exports = { getSetting, setSetting, getEAKey, regenerateEAKey };
