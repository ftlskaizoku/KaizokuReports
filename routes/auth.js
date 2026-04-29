'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { query } = require('../db/db');
const { authMiddleware } = require('./middleware');

// ─── POST /api/auth/login ───────────────────────────────────────
// Accepts email OR username in the "login" field
router.post('/login', async (req, res) => {
  try {
    const { login, email, username, password } = req.body;
    const identifier = (login || email || username || '').trim().toLowerCase();

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Login and password required.' });
    }

    // Look up by email first, then by username
    const result = await query(
      `SELECT * FROM users
       WHERE (LOWER(email)=$1 OR LOWER(username)=$1)
         AND (status IS NULL OR status='active')
       LIMIT 1`,
      [identifier]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user  = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    await query(`UPDATE users SET last_login=NOW() WHERE id=$1`, [user.id]);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, display_name: user.display_name, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── GET /api/auth/me ───────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const r = await query(
      `SELECT id, username, email, display_name, role, last_login FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── POST /api/auth/change-password ────────────────────────────
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Both passwords required.' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    const r    = await query(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const hash = await bcrypt.hash(new_password, 12);
    await query(`UPDATE users SET password_hash=$1 WHERE id=$2`, [hash, req.user.id]);
    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── PATCH /api/auth/profile ────────────────────────────────────
// Update own display name, username, or email
router.patch('/profile', authMiddleware, async (req, res) => {
  try {
    const { username, display_name, email } = req.body;
    const updates = []; const params = []; let idx = 1;

    if (display_name !== undefined) {
      updates.push(`display_name=$${idx++}`);
      params.push(display_name.trim());
    }
    if (username !== undefined) {
      if (username.trim().length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters.' });
      updates.push(`username=$${idx++}`);
      params.push(username.toLowerCase().trim());
    }
    if (email !== undefined) {
      // Basic email format check
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Invalid email format.' });
      }
      updates.push(`email=$${idx++}`);
      params.push(email ? email.toLowerCase().trim() : null);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

    params.push(req.user.id);
    const r = await query(
      `UPDATE users SET ${updates.join(',')} WHERE id=$${idx}
       RETURNING id, username, email, display_name, role`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'That username or email is already taken.' });
    }
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
