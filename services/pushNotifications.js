'use strict';

const webpush  = require('web-push');
const { query } = require('../db/db');

// Configure VAPID
webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Save or update a push subscription for a user
 */
async function saveSubscription(userId, subscription, deviceLabel = null) {
  // Check if this endpoint already exists
  const existing = await query(
    `SELECT id FROM push_subscriptions WHERE user_id=$1 AND subscription->>'endpoint'=$2`,
    [userId, subscription.endpoint]
  );

  if (existing.rows.length > 0) {
    await query(
      `UPDATE push_subscriptions SET subscription=$1, updated_at=NOW() WHERE id=$2`,
      [JSON.stringify(subscription), existing.rows[0].id]
    );
  } else {
    await query(
      `INSERT INTO push_subscriptions (user_id, subscription, device_label) VALUES ($1,$2,$3)`,
      [userId, JSON.stringify(subscription), deviceLabel]
    );
  }
}

/**
 * Remove a subscription (user unsubscribed)
 */
async function removeSubscription(endpoint) {
  await query(
    `DELETE FROM push_subscriptions WHERE subscription->>'endpoint'=$1`,
    [endpoint]
  );
}

/**
 * Send a notification to all subscribed users
 */
async function notifyAll(title, body, data = {}) {
  const subs = await query(`SELECT id, subscription FROM push_subscriptions`);
  if (subs.rows.length === 0) return;

  const payload = JSON.stringify({
    title,
    body,
    icon:   '/icons/icon-192.png',
    badge:  '/icons/badge-72.png',
    data:   { url: data.url || '/', ...data },
    timestamp: Date.now(),
  });

  const results = await Promise.allSettled(
    subs.rows.map(row =>
      webpush.sendNotification(
        typeof row.subscription === 'string'
          ? JSON.parse(row.subscription)
          : row.subscription,
        payload
      ).catch(async err => {
        // Remove dead subscriptions (410 = Gone)
        if (err.statusCode === 410 || err.statusCode === 404) {
          const sub = typeof row.subscription === 'string'
            ? JSON.parse(row.subscription)
            : row.subscription;
          await removeSubscription(sub.endpoint).catch(() => {});
        }
        throw err;
      })
    )
  );

  const sent   = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`Push notifications: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}

/**
 * Send daily report notifications for all symbols
 */
async function sendDailyReportNotifications(reports) {
  if (!reports || reports.length === 0) return;

  // Build a combined summary notification
  const lines = reports.map(r => {
    const emoji = r.bias === 'bullish' ? '▲' : r.bias === 'bearish' ? '▼' : '↔';
    return `${emoji} ${r.symbol}: ${r.candle_type?.replace(/_/g,' ')} · ${r.bias}`;
  });

  const title = '📊 Daily Market Report';
  const body  = lines.join('\n');

  await notifyAll(title, body, { url: '/reports' });
}

module.exports = {
  saveSubscription,
  removeSubscription,
  notifyAll,
  sendDailyReportNotifications,
};
