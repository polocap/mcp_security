import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database.js';
import type { Analysis, AnalysisStatus } from '../../types/analysis.js';
import type { AggregateScore } from '../../types/scores.js';

export interface CreateAnalysisInput {
  projectId: string;
  gitCommit?: string;
  gitBranch?: string;
  config?: Record<string, unknown>;
}

export interface UpdateAnalysisInput {
  status?: AnalysisStatus;
  completedAt?: string;
  durationMs?: number;
  scores?: AggregateScore;
  scannersRun?: string[];
  scannersFailed?: string[];
  error?: string;
}

export class AnalysesRepository {
  private db = getDatabase();

  create(input: CreateAnalysisInput): Analysis {
    const now = new Date().toISOString();
    const id = uuidv4();

    const stmt = this.db.prepare(`
      INSERT INTO analyses (
        id, project_id, started_at, status, git_commit, git_branch, config, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.projectId,
      now,
      'running',
      input.gitCommit || null,
      input.gitBranch || null,
      input.config ? JSON.stringify(input.config) : null,
      now
    );

    return this.findById(id)!;
  }

  findById(id: string): Analysis | null {
    const stmt = this.db.prepare('SELECT * FROM analyses WHERE id = ?');
    const row = stmt.get(id) as AnalysisRow | undefined;
    return row ? this.mapRowToAnalysis(row) : null;
  }

  findByProjectId(projectId: string, limit = 10): Analysis[] {
    const stmt = this.db.prepare(`
      SELECT * FROM analyses
      WHERE project_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(projectId, limit) as AnalysisRow[];
    return rows.map(this.mapRowToAnalysis);
  }

  findLatestByProjectId(projectId: string): Analysis | null {
    const stmt = this.db.prepare(`
      SELECT * FROM analyses
      WHERE project_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const row = stmt.get(projectId) as AnalysisRow | undefined;
    return row ? this.mapRowToAnalysis(row) : null;
  }

  update(id: string, input: UpdateAnalysisInput): Analysis | null {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }
    if (input.completedAt !== undefined) {
      updates.push('completed_at = ?');
      values.push(input.completedAt);
    }
    if (input.durationMs !== undefined) {
      updates.push('duration_ms = ?');
      values.push(input.durationMs);
    }
    if (input.scores !== undefined) {
      updates.push('overall_score = ?');
      values.push(input.scores.overall);
      updates.push('security_score = ?');
      values.push(input.scores.security);
      updates.push('quality_score = ?');
      values.push(input.scores.quality);
      updates.push('dependency_score = ?');
      values.push(input.scores.dependencies);
      updates.push('architecture_score = ?');
      values.push(input.scores.architecture);
      updates.push('grade = ?');
      values.push(input.scores.grade);
    }
    if (input.scannersRun !== undefined) {
      updates.push('scanners_run = ?');
      values.push(JSON.stringify(input.scannersRun));
    }
    if (input.scannersFailed !== undefined) {
      updates.push('scanners_failed = ?');
      values.push(JSON.stringify(input.scannersFailed));
    }
    if (input.error !== undefined) {
      updates.push('error = ?');
      values.push(input.error);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const stmt = this.db.prepare(`UPDATE analyses SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.findById(id);
  }

  complete(id: string, scores: AggregateScore, scannersRun: string[], scannersFailed: string[]): Analysis | null {
    const now = new Date().toISOString();
    const analysis = this.findById(id);
    if (!analysis) return null;

    const durationMs = new Date(now).getTime() - new Date(analysis.startedAt).getTime();

    return this.update(id, {
      status: 'completed',
      completedAt: now,
      durationMs,
      scores,
      scannersRun,
      scannersFailed,
    });
  }

  fail(id: string, error: string, scannersRun: string[], scannersFailed: string[]): Analysis | null {
    const now = new Date().toISOString();
    const analysis = this.findById(id);
    if (!analysis) return null;

    const durationMs = new Date(now).getTime() - new Date(analysis.startedAt).getTime();

    return this.update(id, {
      status: 'failed',
      completedAt: now,
      durationMs,
      scannersRun,
      scannersFailed,
      error,
    });
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM analyses WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  private mapRowToAnalysis(row: AnalysisRow): Analysis {
    return {
      id: row.id,
      projectId: row.project_id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      status: row.status as AnalysisStatus,
      durationMs: row.duration_ms,
      gitCommit: row.git_commit,
      gitBranch: row.git_branch,
      scores: row.overall_score !== null ? {
        overall: row.overall_score,
        security: row.security_score!,
        quality: row.quality_score!,
        dependencies: row.dependency_score!,
        architecture: row.architecture_score!,
        grade: row.grade as 'A' | 'B' | 'C' | 'D' | 'F',
        trend: null,
      } : null,
      scannersRun: JSON.parse(row.scanners_run || '[]') as string[],
      scannersFailed: JSON.parse(row.scanners_failed || '[]') as string[],
      config: row.config ? JSON.parse(row.config) as Record<string, unknown> : null,
      error: row.error,
      createdAt: row.created_at,
    };
  }
}

interface AnalysisRow {
  id: string;
  project_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  duration_ms: number | null;
  git_commit: string | null;
  git_branch: string | null;
  overall_score: number | null;
  security_score: number | null;
  quality_score: number | null;
  dependency_score: number | null;
  architecture_score: number | null;
  grade: string | null;
  scanners_run: string | null;
  scanners_failed: string | null;
  config: string | null;
  error: string | null;
  created_at: string;
}

export const analysesRepository = new AnalysesRepository();
