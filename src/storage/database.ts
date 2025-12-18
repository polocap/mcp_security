import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { runMigrations } from './migrations/index.js';

const DEFAULT_DB_PATH = join(homedir(), '.mcp-analyzer', 'data', 'mcp-analyzer.db');

let db: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (db) {
    return db;
  }

  const path = dbPath || process.env['MCP_ANALYZER_DB_PATH'] || DEFAULT_DB_PATH;

  // Ensure directory exists
  const dir = join(path, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    logger.info(`Created database directory: ${dir}`);
  }

  logger.info(`Opening database at: ${path}`);
  db = new Database(path);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(db);

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});
