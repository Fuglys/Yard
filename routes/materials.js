// Materials uit dagstart_db (read-only)
const express = require('express');
const { dagstartPool } = require('../lib/db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await dagstartPool.query(
      "SELECT id, name FROM materials WHERE is_test = false AND is_active = true ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/materials error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/all', async (req, res) => {
  try {
    const { rows } = await dagstartPool.query(
      "SELECT id, name, is_test FROM materials WHERE is_active = true ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/materials/all error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
