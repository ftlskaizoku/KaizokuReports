'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { query } = require('../db/db');
const { authMiddleware } = require('./middleware');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });

    const result = await query(`SELECT * FROM users WHERE username=$1`, [username.toLowerCase().trim()]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials.' });

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
      user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const r = await query(`SELECT id, username, display_name, role, last_login FROM users WHERE id=$1`, [req.user.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// PATCH /api/auth/profile — update own display name and/or password
router.patch('/profile', authMiddleware, async (req, res) => {
  try {
    const { display_name, current_password, new_password } = req.body;
    const updates = [];
    const params  = [];
    let   idx     = 1;

    // Display name change (no password needed)
    if (display_name !== undefined) {
      if (!display_name.trim()) return res.status(400).json({ error: 'Display name cannot be empty.' });
      updates.push(`display_name=$${idx++}`);
      params.push(display_name.trim());
    }

    // Password change (requires current password)
    if (new_password) {
      if (!current_password) return res.status(400).json({ error: 'Current password required to set a new one.' });
      if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

      const r = await query(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
      const valid = await bcrypt.compare(current_password, r.rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

      const hash = await bcrypt.hash(new_password, 12);
      updates.push(`password_hash=$${idx++}`);
      params.push(hash);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

    params.push(req.user.id);
    const r = await query(
      `UPDATE users SET ${updates.join(',')} WHERE id=$${idx} RETURNING id, username, display_name, role`,
      params
    );

    res.json({ message: 'Profile updated.', user: r.rows[0] });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;

// PATCH /api/auth/profile — update own username + display name
router.patch('/profile', require('./middleware').authMiddleware, async (req, res) => {
  try {
    const { username, display_name } = req.body;
    const updates = []; const params = []; let idx = 1;
    if (display_name !== undefined) { updates.push(`display_name=$${idx++}`); params.push(display_name.trim()); }
    if (username !== undefined) {
      if (username.trim().length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters.' });
      updates.push(`username=$${idx++}`); params.push(username.toLowerCase().trim());
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    params.push(req.user.id);
    const r = await query(`UPDATE users SET ${updates.join(',')} WHERE id=$${idx} RETURNING id,username,display_name,role`, params);
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Username already taken.' });
    res.status(500).json({ error: 'Server error' });
  }
});
