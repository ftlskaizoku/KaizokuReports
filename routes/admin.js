'use strict';

const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const { query } = require('../db/db');
const { authMiddleware, adminMiddleware } = require('./middleware');
const { getEAKey, regenerateEAKey } = require('../services/settingsService');
const { runClassificationJob, runPatternStatsJob, runReportJob } = require('../services/scheduler');

// All admin routes require JWT + admin role
router.use(authMiddleware, adminMiddleware);

// GET /api/admin/users — list all users
router.get('/users', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, display_name, role, last_login, created_at
       FROM users ORDER BY id`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/users — add a new user (max 4 total)
router.post('/users', async (req, res) => {
  try {
    const count = await query(`SELECT COUNT(*) AS c FROM users`);
    if (parseInt(count.rows[0].c) >= 4) {
      return res.status(400).json({ error: 'Maximum 4 users reached.' });
    }

    const { username, password, display_name, role } = req.body;
    if (!username || username.trim().length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters.' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const hash = await bcrypt.hash(password, 12);
    const r = await query(
      `INSERT INTO users (username, password_hash, display_name, role)
       VALUES ($1,$2,$3,$4)
       RETURNING id, username, display_name, role`,
      [username.toLowerCase().trim(), hash, display_name || username, role === 'admin' ? 'admin' : 'user']
    );
    res.json({ message: 'User created.', user: r.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Username already exists.' });
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/admin/users/:id — update any user (display name, password, role)
router.patch('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { display_name, password, role } = req.body;
    const updates = [];
    const params  = [];
    let   idx     = 1;

    if (display_name !== undefined) { updates.push(`display_name=$${idx++}`); params.push(display_name); }
    if (role !== undefined)         { updates.push(`role=$${idx++}`);         params.push(role === 'admin' ? 'admin' : 'user'); }
    if (password) {
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      const hash = await bcrypt.hash(password, 12);
      updates.push(`password_hash=$${idx++}`);
      params.push(hash);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

    params.push(id);
    const r = await query(
      `UPDATE users SET ${updates.join(',')} WHERE id=$${idx}
       RETURNING id, username, display_name, role`,
      params
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'User updated.', user: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/admin/users/:id — remove a user (cannot delete yourself)
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }
    const r = await query(`DELETE FROM users WHERE id=$1 RETURNING username`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: `User "${r.rows[0].username}" removed.` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/admin/ea-key — get current EA API key
router.get('/ea-key', async (req, res) => {
  try {
    const key = await getEAKey();
    res.json({ ea_key: key });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/ea-key/regenerate — generate a new EA key
router.post('/ea-key/regenerate', async (req, res) => {
  try {
    const key = await regenerateEAKey();
    res.json({ message: 'EA API key regenerated. Update it in the EA settings.', ea_key: key });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/admin/run-jobs — manually trigger nightly jobs
router.post('/run-jobs', async (req, res) => {
  try {
    res.json({ message: 'Jobs started. Check Railway logs for progress.' });
    setImmediate(async () => {
      await runClassificationJob();
      await runPatternStatsJob();
      await runReportJob();
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
