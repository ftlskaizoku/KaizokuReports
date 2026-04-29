'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { query } = require('../db/db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const result = await query(
      `SELECT * FROM users WHERE username=$1`,
      [username.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user  = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await query(`UPDATE users SET last_login=NOW() WHERE id=$1`, [user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id:           user.id,
        username:     user.username,
        display_name: user.display_name,
        role:         user.role,
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me — verify token and return user info
router.get('/me', require('./middleware').authMiddleware, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, display_name, role, last_login FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/setup — one-time setup to create the 4 users
// Protected by EA_API_KEY to prevent abuse
router.post('/setup', async (req, res) => {
  try {
    const { setup_key, users } = req.body;

    if (setup_key !== process.env.EA_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check if users already exist
    const existing = await query(`SELECT COUNT(*) as count FROM users`);
    if (+existing.rows[0].count > 0) {
      return res.status(400).json({ error: 'Users already set up. Use /change-password to update.' });
    }

    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'Provide users array: [{username, password, display_name}]' });
    }

    if (users.length > 4) {
      return res.status(400).json({ error: 'Maximum 4 users allowed' });
    }

    const created = [];
    for (const u of users) {
      const hash = await bcrypt.hash(u.password, 12);
      const r    = await query(
        `INSERT INTO users (username, password_hash, display_name, role)
         VALUES ($1,$2,$3,$4) RETURNING id, username, display_name`,
        [u.username.toLowerCase(), hash, u.display_name || u.username, u.role || 'user']
      );
      created.push(r.rows[0]);
    }

    res.json({ message: 'Users created', users: created });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', require('./middleware').authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Both current and new password required' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const result = await query(`SELECT * FROM users WHERE id=$1`, [req.user.id]);
    const user   = result.rows[0];

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

    const newHash = await bcrypt.hash(new_password, 12);
    await query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [newHash, req.user.id]);

    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
