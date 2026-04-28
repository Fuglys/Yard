// Materials uit dagstart_db (read-only)
const express = require('express');
const { dagstartPool } = require('../lib/db');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { rows } = await dagstartPool.query(
      "SELECT id, name FROM materials WHERE is_active = true ORDER BY name"
    );
    // Markeer test-materialen op basis van naam
    const result = rows.map(r => ({
      ...r,
      is_test: /test/i.test(r.name),
    }));
    res.json(result);
  } catch (err) {
    console.error('GET /api/materials error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/all', async (req, res) => {
  try {
    const { rows } = await dagstartPool.query(
      "SELECT id, name FROM materials WHERE is_active = true ORDER BY name"
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/materials/all error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
