'use strict';

const jwt = require('jsonwebtoken');
const { getEAKey } = require('../services/settingsService');

function authMiddleware(req, res, next) {
  const token = (req.headers['authorization'] || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

async function eaAuthMiddleware(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing X-Api-Key header' });
  try {
    const validKey = await getEAKey();
    if (key !== validKey) return res.status(401).json({ error: 'Invalid EA API key' });
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

module.exports = { authMiddleware, adminMiddleware, eaAuthMiddleware };
