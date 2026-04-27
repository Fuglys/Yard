// Auth tegen dagstart_db.users — alleen admin/supervisor mogen.
const express = require('express');
const bcrypt = require('bcrypt');
const { dagstartPool } = require('../lib/db');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Vul beide velden in' });
  try {
    const { rows } = await dagstartPool.query(
      "SELECT id, username, password_hash, role, is_active FROM users WHERE username = $1 OR email = $1",
      [username]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Gebruiker niet gevonden' });
    const user = rows[0];
    if (!user.is_active) return res.status(401).json({ error: 'Account niet actief' });
    if (user.role !== 'admin' && user.role !== 'supervisor') {
      return res.status(403).json({ error: 'Geen admin rechten' });
    }
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Onjuist wachtwoord' });
    res.json({ ok: true, username: user.username, role: user.role });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'Server fout' });
  }
});

module.exports = router;
