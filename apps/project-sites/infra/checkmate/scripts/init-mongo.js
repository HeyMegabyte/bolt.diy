// MongoDB init script — creates the uptime_db database
// Executed by mongosh on first boot if needed.
// In practice, Mongoose will auto-create the database on first connection,
// so this is a safety net for manual restores and verification.

db = db.getSiblingDB('uptime_db');
db.createCollection('_init');
print('Checkmate uptime_db initialized.');
