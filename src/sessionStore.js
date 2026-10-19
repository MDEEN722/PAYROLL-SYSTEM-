const session = require("express-session");

// Store sessions alongside payroll data so logins survive server restarts.
class SQLiteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS web_sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    this.getStmt = db.prepare("SELECT sess FROM web_sessions WHERE sid=? AND expires_at>?");
    this.setStmt = db.prepare("INSERT INTO web_sessions (sid,sess,expires_at) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expires_at=excluded.expires_at");
    this.delStmt = db.prepare("DELETE FROM web_sessions WHERE sid=?");
    this.pruneStmt = db.prepare("DELETE FROM web_sessions WHERE expires_at<=?");
    this.lastPrune = 0;
  }
  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (err) { cb(err); }
  }
  set(sid, sess, cb) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 60 * 60 * 1000;
      this.setStmt.run(sid, JSON.stringify(sess), expires);
      if (Date.now() - this.lastPrune > 60 * 60 * 1000) {
        this.pruneStmt.run(Date.now());
        this.lastPrune = Date.now();
      }
      cb?.(null);
    } catch (err) { cb?.(err); }
  }
  destroy(sid, cb) {
    try { this.delStmt.run(sid); cb?.(null); } catch (err) { cb?.(err); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

module.exports = SQLiteSessionStore;
