'use strict';

const router = require('express').Router();
const { authMiddleware } = require('./middleware');
const { saveSubscription, removeSubscription } = require('../services/pushNotifications');

// GET /api/push/vapid-public-key
router.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { subscription, device_label } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }
    await saveSubscription(req.user.id, subscription, device_label);
    res.json({ message: 'Subscribed successfully' });
  } catch (err) {
    console.error('Subscribe error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/push/unsubscribe
router.post('/unsubscribe', authMiddleware, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'Endpoint required' });
    await removeSubscription(endpoint);
    res.json({ message: 'Unsubscribed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
