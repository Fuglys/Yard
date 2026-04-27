// In-memory event bus voor SSE — broadcast wijzigingen naar verbonden clients.
// Voor 3 tablets + admin is dit ruim voldoende; geen Redis nodig.

const subscribers = new Set();

function subscribe(res) {
  subscribers.add(res);
  // Verwijder bij disconnect
  res.on('close', () => subscribers.delete(res));
}

function broadcast(event, data, exceptId = null) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of subscribers) {
    if (exceptId && res.__clientId === exceptId) continue;
    try { res.write(payload); } catch (_) { subscribers.delete(res); }
  }
}

function count() { return subscribers.size; }

module.exports = { subscribe, broadcast, count };
