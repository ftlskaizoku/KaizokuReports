'use strict';

const webpush  = require('web-push');
const { query } = require('../db/db');

// ═══════════════════════════════════════════════════════════
// LAZY VAPID INIT — fixes the Railway startup crash.
// web-push throws immediately if setVapidDetails() is called
// with missing values. Deferring to first use means the server
// starts fine even before VAPID keys are added to Railway.
// ═══════════════════════════════════════════════════════════
let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return true;
  const email   = process.env.VAPID_EMAIL;
  const pubKey  = process.env.VAPID_PUBLIC_KEY;
  const privKey = process.env.VAPID_PRIVATE_KEY;
  if (!email || !pubKey || !privKey) {
    console.warn('VAPID keys not set — push notifications disabled until configured.');
    return false;
  }
  try {
    webpush.setVapidDetails(email, pubKey, privKey);
    vapidConfigured = true;
    console.log('VAPID configured');
    return true;
  } catch (err) {
    console.error('VAPID config error:', err.message);
    return false;
  }
}

async function saveSubscription(userId, subscription, deviceLabel = null) {
  if (!ensureVapid()) throw new Error('Push not configured. Add VAPID keys in Railway Variables.');
  const existing = await query(
    `SELECT id FROM push_subscriptions WHERE user_id=$1 AND subscription->>'endpoint'=$2`,
    [userId, subscription.endpoint]
  );
  if (existing.rows.length > 0) {
    await query(`UPDATE push_subscriptions SET subscription=$1, updated_at=NOW() WHERE id=$2`,
      [JSON.stringify(subscription), existing.rows[0].id]);
  } else {
    await query(`INSERT INTO push_subscriptions (user_id, subscription, device_label) VALUES ($1,$2,$3)`,
      [userId, JSON.stringify(subscription), deviceLabel]);
  }
}

async function removeSubscription(endpoint) {
  await query(`DELETE FROM push_subscriptions WHERE subscription->>'endpoint'=$1`, [endpoint]);
}

async function notifyAll(title, body, data = {}) {
  if (!ensureVapid()) { console.warn('Push skipped — VAPID not configured.'); return { sent:0, failed:0 }; }
  const subs = await query(`SELECT id, subscription FROM push_subscriptions`);
  if (subs.rows.length === 0) return { sent:0, failed:0 };
  const payload = JSON.stringify({
    title, body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url: data.url || '/', ...data },
    timestamp: Date.now(),
  });
  const results = await Promise.allSettled(
    subs.rows.map(row => {
      const sub = typeof row.subscription === 'string' ? JSON.parse(row.subscription) : row.subscription;
      return webpush.sendNotification(sub, payload).catch(async err => {
        if (err.statusCode === 410 || err.statusCode === 404) await removeSubscription(sub.endpoint).catch(()=>{});
        throw err;
      });
    })
  );
  const sent = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`Push: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}

async function sendDailyReportNotifications(reports) {
  if (!reports || reports.length === 0) return;
  const lines = reports.map(r => {
    const e = r.bias === 'bullish' ? '▲' : r.bias === 'bearish' ? '▼' : '↔';
    return `${e} ${r.symbol}: ${(r.candle_type||'').replace(/_/g,' ')} · ${r.bias}`;
  });
  await notifyAll('📊 Kaizoku Daily Report', lines.join('\n'), { url: '/' });
}

module.exports = { ensureVapid, saveSubscription, removeSubscription, notifyAll, sendDailyReportNotifications };
