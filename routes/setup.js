'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { query } = require('../db/db');
const { isSetupRequired, getEAKey } = require('../services/settingsService');

// GET /api/setup/status
router.get('/status', async (req, res) => {
  try {
    const needed = await isSetupRequired();
    res.json({ setup_required: needed });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/setup — create initial admin + optional extra users
// Only works when zero users exist
router.post('/', async (req, res) => {
  try {
    const needed = await isSetupRequired();
    if (!needed) {
      return res.status(400).json({ error: 'Setup already complete. Manage users in Admin Panel.' });
    }

    const { users } = req.body;
    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'Provide a users array.' });
    }
    if (users.length > 4) {
      return res.status(400).json({ error: 'Maximum 4 users allowed.' });
    }

    // Validate all entries
    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      if (!u.username || u.username.trim().length < 2) {
        return res.status(400).json({ error: `User ${i+1}: username must be at least 2 characters.` });
      }
      if (!u.password || u.password.length < 8) {
        return res.status(400).json({ error: `User ${i+1} ("${u.username}"): password must be at least 8 characters.` });
      }
    }

    const created = [];
    for (let i = 0; i < users.length; i++) {
      const u    = users[i];
      const hash = await bcrypt.hash(u.password, 12);
      const role = i === 0 ? 'admin' : 'user'; // First user = admin
      const email = u.email ? u.email.toLowerCase().trim() : null;

      const r = await query(
        `INSERT INTO users (username, email, password_hash, display_name, role)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, username, email, display_name, role`,
        [u.username.toLowerCase().trim(), email, hash, u.display_name || u.username, role]
      );
      created.push(r.rows[0]);
    }

    const eaKey = await getEAKey();
    res.json({ message: 'Setup complete. You can now log in.', users: created, ea_key: eaKey });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'A username or email is already taken.' });
    }
    console.error('Setup error:', err);
    res.status(500).json({ error: 'Server error during setup.' });
  }
});

module.exports = router;
