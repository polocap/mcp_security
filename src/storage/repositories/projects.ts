import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database.js';
import type { Project } from '../../types/analysis.js';

export interface CreateProjectInput {
  path: string;
  name: string;
  detectedLanguages?: string[];
}

export class ProjectsRepository {
  private db = getDatabase();

  create(input: CreateProjectInput): Project {
    const now = new Date().toISOString();
    const id = uuidv4();

    const stmt = this.db.prepare(`
      INSERT INTO projects (id, path, name, detected_languages, first_analyzed_at, last_analyzed_at, analysis_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.path,
      input.name,
      JSON.stringify(input.detectedLanguages || []),
      now,
      now,
      0,
      now
    );

    return this.findById(id)!;
  }

  findById(id: string): Project | null {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    const row = stmt.get(id) as ProjectRow | undefined;
    return row ? this.mapRowToProject(row) : null;
  }

  findByPath(path: string): Project | null {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE path = ?');
    const row = stmt.get(path) as ProjectRow | undefined;
    return row ? this.mapRowToProject(row) : null;
  }

  findOrCreate(input: CreateProjectInput): Project {
    const existing = this.findByPath(input.path);
    if (existing) {
      return existing;
    }
    return this.create(input);
  }

  updateLastAnalyzed(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE projects
      SET last_analyzed_at = ?, analysis_count = analysis_count + 1
      WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), id);
  }

  updateLanguages(id: string, languages: string[]): void {
    const stmt = this.db.prepare('UPDATE projects SET detected_languages = ? WHERE id = ?');
    stmt.run(JSON.stringify(languages), id);
  }

  listAll(limit = 100, offset = 0): Project[] {
    const stmt = this.db.prepare(`
      SELECT * FROM projects
      ORDER BY last_analyzed_at DESC
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(limit, offset) as ProjectRow[];
    return rows.map(this.mapRowToProject);
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  private mapRowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      detectedLanguages: JSON.parse(row.detected_languages || '[]') as string[],
      firstAnalyzedAt: row.first_analyzed_at,
      lastAnalyzedAt: row.last_analyzed_at,
      analysisCount: row.analysis_count,
      createdAt: row.created_at,
    };
  }
}

interface ProjectRow {
  id: string;
  path: string;
  name: string;
  detected_languages: string;
  first_analyzed_at: string;
  last_analyzed_at: string;
  analysis_count: number;
  created_at: string;
}

export const projectsRepository = new ProjectsRepository();
