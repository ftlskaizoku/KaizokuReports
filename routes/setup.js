'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { query } = require('../db/db');
const { isSetupRequired, getEAKey } = require('../services/settingsService');

// GET /api/setup/status — is setup needed?
router.get('/status', async (req, res) => {
  try {
    const needed = await isSetupRequired();
    res.json({ setup_required: needed });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/setup — create initial users (only works if no users exist)
router.post('/', async (req, res) => {
  try {
    const needed = await isSetupRequired();
    if (!needed) {
      return res.status(400).json({ error: 'Setup already complete. Manage users in the app Settings.' });
    }

    const { users } = req.body;
    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'Provide a users array.' });
    }
    if (users.length > 4) {
      return res.status(400).json({ error: 'Maximum 4 users allowed.' });
    }

    // Validate
    for (const u of users) {
      if (!u.username || u.username.trim().length < 2) {
        return res.status(400).json({ error: 'All usernames must be at least 2 characters.' });
      }
      if (!u.password || u.password.length < 8) {
        return res.status(400).json({ error: `Password for "${u.username}" must be at least 8 characters.` });
      }
    }

    const created = [];
    for (let i = 0; i < users.length; i++) {
      const u    = users[i];
      const hash = await bcrypt.hash(u.password, 12);
      const role = i === 0 ? 'admin' : 'user'; // First user is always admin
      const r    = await query(
        `INSERT INTO users (username, password_hash, display_name, role)
         VALUES ($1,$2,$3,$4)
         RETURNING id, username, display_name, role`,
        [u.username.toLowerCase().trim(), hash, u.display_name || u.username, role]
      );
      created.push(r.rows[0]);
    }

    // Get the auto-generated EA key to show the admin
    const eaKey = await getEAKey();

    res.json({
      message:  'Setup complete! You can now log in.',
      users:    created,
      ea_key:   eaKey,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'One of the usernames already exists.' });
    }
    console.error('Setup error:', err);
    res.status(500).json({ error: 'Server error during setup.' });
  }
});

module.exports = router;
