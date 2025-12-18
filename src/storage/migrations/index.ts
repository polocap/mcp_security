import type Database from 'better-sqlite3';
import { logger } from '../../utils/logger.js';

interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: (db) => {
      // Projects table
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          detected_languages TEXT,
          first_analyzed_at TEXT NOT NULL,
          last_analyzed_at TEXT NOT NULL,
          analysis_count INTEGER DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
      `);

      // Analyses table
      db.exec(`
        CREATE TABLE IF NOT EXISTS analyses (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          status TEXT DEFAULT 'pending',
          duration_ms INTEGER,
          git_commit TEXT,
          git_branch TEXT,
          overall_score INTEGER,
          security_score INTEGER,
          quality_score INTEGER,
          dependency_score INTEGER,
          architecture_score INTEGER,
          grade TEXT,
          scanners_run TEXT,
          scanners_failed TEXT,
          config TEXT,
          error TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_analyses_project ON analyses(project_id);
        CREATE INDEX IF NOT EXISTS idx_analyses_status ON analyses(status);
        CREATE INDEX IF NOT EXISTS idx_analyses_completed ON analyses(completed_at);
      `);

      // Findings table
      db.exec(`
        CREATE TABLE IF NOT EXISTS findings (
          id TEXT PRIMARY KEY,
          analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
          scanner TEXT NOT NULL,
          category TEXT NOT NULL,
          severity TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          file TEXT,
          line INTEGER,
          column_num INTEGER,
          code_snippet TEXT,
          remediation TEXT,
          cwe TEXT,
          cve TEXT,
          rule_id TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_findings_analysis ON findings(analysis_id);
        CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
        CREATE INDEX IF NOT EXISTS idx_findings_category ON findings(category);
        CREATE INDEX IF NOT EXISTS idx_findings_file ON findings(file);
      `);

      // Scanner runs table
      db.exec(`
        CREATE TABLE IF NOT EXISTS scanner_runs (
          id TEXT PRIMARY KEY,
          analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
          scanner_name TEXT NOT NULL,
          category TEXT NOT NULL,
          language TEXT,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          duration_ms INTEGER,
          findings_count INTEGER DEFAULT 0,
          raw_score INTEGER,
          status TEXT DEFAULT 'running',
          error TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_scanner_runs_analysis ON scanner_runs(analysis_id);
      `);

      // Graph nodes table (for Knowledge Graph)
      db.exec(`
        CREATE TABLE IF NOT EXISTS graph_nodes (
          id TEXT PRIMARY KEY,
          analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          file TEXT,
          line_start INTEGER,
          line_end INTEGER,
          metadata TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_graph_nodes_analysis ON graph_nodes(analysis_id);
        CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(type);
        CREATE INDEX IF NOT EXISTS idx_graph_nodes_file ON graph_nodes(file);
      `);

      // Graph edges table
      db.exec(`
        CREATE TABLE IF NOT EXISTS graph_edges (
          id TEXT PRIMARY KEY,
          analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
          source_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
          target_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_graph_edges_analysis ON graph_edges(analysis_id);
        CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);
        CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);
        CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(type);
      `);

      // Migrations tracking table
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
    },
  },
];

export function runMigrations(db: Database.Database): void {
  // Ensure migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Get current version
  const currentVersion = db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as { version: number | null };
  const appliedVersion = currentVersion?.version || 0;

  logger.debug(`Current database version: ${appliedVersion}`);

  // Run pending migrations
  const pendingMigrations = migrations.filter((m) => m.version > appliedVersion);

  if (pendingMigrations.length === 0) {
    logger.debug('No pending migrations');
    return;
  }

  logger.info(`Running ${pendingMigrations.length} migration(s)...`);

  for (const migration of pendingMigrations) {
    logger.info(`Applying migration ${migration.version}: ${migration.name}`);

    const transaction = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
        migration.version,
        migration.name
      );
    });

    transaction();
    logger.success(`Migration ${migration.version} applied successfully`);
  }
}

export function getCurrentVersion(db: Database.Database): number {
  const result = db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as { version: number | null };
  return result?.version || 0;
}
