// SSE endpoint — clients luisteren hier voor server-pushed updates.
const express = require('express');
const bus = require('../lib/eventBus');

const router = express.Router();

router.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Client kan zichzelf identificeren via ?clientId=xxx zodat we eigen broadcasts overslaan
  res.__clientId = req.query.clientId || null;

  // initial hello
  res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now(), connected: bus.count() + 1 })}\n\n`);

  // heartbeat elke 25s om proxies/load-balancers wakker te houden
  const hb = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch (_) { clearInterval(hb); }
  }, 25000);

  bus.subscribe(res);

  req.on('close', () => clearInterval(hb));
});

module.exports = router;
