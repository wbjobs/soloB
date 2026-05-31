const sqlite3 = require('sqlite3').verbose();

class OCFDatabase {
  constructor(dbPath) {
    this.db = new sqlite3.Database(dbPath);
    this.initTables();
  }

  initTables() {
    this.db.serialize(() => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS test_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT,
          device_name TEXT,
          device_ip TEXT,
          device_port INTEGER,
          status TEXT DEFAULT 'running',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS test_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER,
          resource_path TEXT,
          description TEXT,
          status TEXT,
          http_code INTEGER,
          response_body TEXT,
          error_message TEXT,
          duration INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES test_sessions(id)
        )
      `);
    });
  }

  createTestSession(deviceInfo) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO test_sessions (device_id, device_name, device_ip, device_port) VALUES (?, ?, ?, ?)`,
        [deviceInfo.id, deviceInfo.name, deviceInfo.ip, deviceInfo.port],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, ...deviceInfo });
        }
      );
    });
  }

  updateTestSessionStatus(sessionId, status) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE test_sessions SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [status, sessionId],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  addTestResult(sessionId, result) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO test_results 
         (session_id, resource_path, description, status, http_code, response_body, error_message, duration)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          result.resourcePath,
          result.description,
          result.status,
          result.httpCode || null,
          result.responseBody ? JSON.stringify(result.responseBody) : null,
          result.errorMessage || null,
          result.duration || 0
        ],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID });
        }
      );
    });
  }

  getTestSessions() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT 
          s.*,
          COUNT(r.id) as total_tests,
          SUM(CASE WHEN r.status = 'pass' THEN 1 ELSE 0 END) as passed_tests
        FROM test_sessions s
        LEFT JOIN test_results r ON s.id = r.session_id
        GROUP BY s.id
        ORDER BY s.created_at DESC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  getTestSession(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT 
          s.*,
          COUNT(r.id) as total_tests,
          SUM(CASE WHEN r.status = 'pass' THEN 1 ELSE 0 END) as passed_tests
        FROM test_sessions s
        LEFT JOIN test_results r ON s.id = r.session_id
        WHERE s.id = ?
        GROUP BY s.id
      `, [sessionId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  getTestResults(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM test_results 
        WHERE session_id = ? 
        ORDER BY created_at
      `, [sessionId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  deleteTestSession(sessionId) {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('DELETE FROM test_results WHERE session_id = ?', [sessionId]);
        this.db.run('DELETE FROM test_sessions WHERE id = ?', [sessionId], (err) => {
          if (err) reject(err);
          else resolve(true);
        });
      });
    });
  }
}

module.exports = OCFDatabase;