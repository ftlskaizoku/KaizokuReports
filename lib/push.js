'use strict';
const webpush = require('web-push');
const { query } = require('./db');

let ready = false;
function init() {
  if (ready) return true;
  const { VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_EMAIL || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  try { webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); ready = true; return true; }
  catch { return false; }
}

async function subscribe(userId, subscription, label) {
  if (!init()) throw new Error('Push not configured — add VAPID keys to Vercel Variables.');
  const ex = await query(`SELECT id FROM push_subscriptions WHERE user_id=$1 AND subscription->>'endpoint'=$2`, [userId, subscription.endpoint]);
  if (ex.rows.length) await query(`UPDATE push_subscriptions SET subscription=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(subscription), ex.rows[0].id]);
  else await query(`INSERT INTO push_subscriptions (user_id,subscription,device_label) VALUES ($1,$2,$3)`, [userId, JSON.stringify(subscription), label]);
}

async function unsubscribe(endpoint) {
  await query(`DELETE FROM push_subscriptions WHERE subscription->>'endpoint'=$1`, [endpoint]);
}

async function sendAll(title, body, url = '/') {
  if (!init()) return { sent: 0, failed: 0 };
  const subs = await query(`SELECT subscription FROM push_subscriptions`);
  if (!subs.rows.length) return { sent: 0, failed: 0 };
  const payload = JSON.stringify({ title, body, icon: '/icons/icon-192.png', data: { url } });
  const results = await Promise.allSettled(subs.rows.map(r => {
    const s = typeof r.subscription === 'string' ? JSON.parse(r.subscription) : r.subscription;
    return webpush.sendNotification(s, payload).catch(async e => {
      if (e.statusCode === 410 || e.statusCode === 404) await unsubscribe(s.endpoint).catch(() => {});
      throw e;
    });
  }));
  return { sent: results.filter(r => r.status === 'fulfilled').length, failed: results.filter(r => r.status === 'rejected').length };
}

async function sendReportNotifications(reports) {
  if (!reports?.length) return;
  const lines = reports.map(r => {
    const e = { bullish: '▲', bearish: '▼', neutral: '↔' }[r.bias || 'neutral'] || '↔';
    return e + ' ' + r.symbol + ': ' + (r.candle_type || '').replace(/_/g, ' ') + ' · ' + r.bias;
  });
  await sendAll('📊 Kaizoku Daily Report', lines.join('\n'));
}

module.exports = { subscribe, unsubscribe, sendAll, sendReportNotifications, vapidPublicKey: () => process.env.VAPID_PUBLIC_KEY || null };
