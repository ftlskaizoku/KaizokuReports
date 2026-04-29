'use strict';

const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function eaAuthMiddleware(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.EA_API_KEY) {
    return res.status(401).json({ error: 'Invalid EA API key' });
  }
  next();
}

module.exports = { authMiddleware, eaAuthMiddleware };
