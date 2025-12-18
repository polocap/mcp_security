import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database.js';
import type { NormalizedFinding, Severity, Category, FindingsSummary } from '../../types/findings.js';

export interface CreateFindingInput {
  analysisId: string;
  scanner: string;
  category: Category;
  severity: Severity;
  title: string;
  description?: string;
  file?: string;
  line?: number;
  column?: number;
  codeSnippet?: string;
  remediation?: string;
  cwe?: string;
  cve?: string;
  ruleId?: string;
  metadata?: Record<string, unknown>;
}

export class FindingsRepository {
  private db = getDatabase();

  create(input: CreateFindingInput): NormalizedFinding {
    const now = new Date().toISOString();
    const id = uuidv4();

    const stmt = this.db.prepare(`
      INSERT INTO findings (
        id, analysis_id, scanner, category, severity, title, description,
        file, line, column_num, code_snippet, remediation, cwe, cve, rule_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.analysisId,
      input.scanner,
      input.category,
      input.severity,
      input.title,
      input.description || null,
      input.file || null,
      input.line || null,
      input.column || null,
      input.codeSnippet || null,
      input.remediation || null,
      input.cwe || null,
      input.cve || null,
      input.ruleId || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now
    );

    return this.findById(id)!;
  }

  createMany(inputs: CreateFindingInput[]): NormalizedFinding[] {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO findings (
        id, analysis_id, scanner, category, severity, title, description,
        file, line, column_num, code_snippet, remediation, cwe, cve, rule_id, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const ids: string[] = [];
    const insertMany = this.db.transaction((inputs: CreateFindingInput[]) => {
      for (const input of inputs) {
        const id = uuidv4();
        ids.push(id);
        stmt.run(
          id,
          input.analysisId,
          input.scanner,
          input.category,
          input.severity,
          input.title,
          input.description || null,
          input.file || null,
          input.line || null,
          input.column || null,
          input.codeSnippet || null,
          input.remediation || null,
          input.cwe || null,
          input.cve || null,
          input.ruleId || null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          now
        );
      }
    });

    insertMany(inputs);
    return ids.map(id => this.findById(id)!);
  }

  findById(id: string): NormalizedFinding | null {
    const stmt = this.db.prepare('SELECT * FROM findings WHERE id = ?');
    const row = stmt.get(id) as FindingRow | undefined;
    return row ? this.mapRowToFinding(row) : null;
  }

  findByAnalysisId(
    analysisId: string,
    options?: {
      severity?: Severity;
      category?: Category;
      filePattern?: string;
      limit?: number;
      offset?: number;
    }
  ): NormalizedFinding[] {
    let query = 'SELECT * FROM findings WHERE analysis_id = ?';
    const params: unknown[] = [analysisId];

    if (options?.severity) {
      query += ' AND severity = ?';
      params.push(options.severity);
    }
    if (options?.category) {
      query += ' AND category = ?';
      params.push(options.category);
    }
    if (options?.filePattern) {
      query += ' AND file LIKE ?';
      params.push(`%${options.filePattern}%`);
    }

    query += ' ORDER BY severity DESC, created_at ASC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options?.offset) {
      query += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as FindingRow[];
    return rows.map(this.mapRowToFinding);
  }

  countByAnalysisId(analysisId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM findings WHERE analysis_id = ?');
    const result = stmt.get(analysisId) as { count: number };
    return result.count;
  }

  getSummaryByAnalysisId(analysisId: string): FindingsSummary {
    const total = this.countByAnalysisId(analysisId);

    // By severity
    const severityStmt = this.db.prepare(`
      SELECT severity, COUNT(*) as count
      FROM findings
      WHERE analysis_id = ?
      GROUP BY severity
    `);
    const severityRows = severityStmt.all(analysisId) as { severity: Severity; count: number }[];
    const bySeverity: Record<Severity, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    for (const row of severityRows) {
      bySeverity[row.severity] = row.count;
    }

    // By category
    const categoryStmt = this.db.prepare(`
      SELECT category, COUNT(*) as count
      FROM findings
      WHERE analysis_id = ?
      GROUP BY category
    `);
    const categoryRows = categoryStmt.all(analysisId) as { category: Category; count: number }[];
    const byCategory: Record<Category, number> = {
      security: 0,
      quality: 0,
      dependencies: 0,
      architecture: 0,
    };
    for (const row of categoryRows) {
      byCategory[row.category] = row.count;
    }

    // By scanner
    const scannerStmt = this.db.prepare(`
      SELECT scanner, COUNT(*) as count
      FROM findings
      WHERE analysis_id = ?
      GROUP BY scanner
    `);
    const scannerRows = scannerStmt.all(analysisId) as { scanner: string; count: number }[];
    const byScanner: Record<string, number> = {};
    for (const row of scannerRows) {
      byScanner[row.scanner] = row.count;
    }

    return { total, bySeverity, byCategory, byScanner };
  }

  deleteByAnalysisId(analysisId: string): number {
    const stmt = this.db.prepare('DELETE FROM findings WHERE analysis_id = ?');
    const result = stmt.run(analysisId);
    return result.changes;
  }

  private mapRowToFinding(row: FindingRow): NormalizedFinding {
    return {
      id: row.id,
      scanner: row.scanner,
      category: row.category as Category,
      severity: row.severity as Severity,
      title: row.title,
      description: row.description || '',
      file: row.file || undefined,
      line: row.line || undefined,
      column: row.column_num || undefined,
      codeSnippet: row.code_snippet || undefined,
      remediation: row.remediation || undefined,
      cwe: row.cwe || undefined,
      cve: row.cve || undefined,
      ruleId: row.rule_id || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
      createdAt: row.created_at,
    };
  }
}

interface FindingRow {
  id: string;
  analysis_id: string;
  scanner: string;
  category: string;
  severity: string;
  title: string;
  description: string | null;
  file: string | null;
  line: number | null;
  column_num: number | null;
  code_snippet: string | null;
  remediation: string | null;
  cwe: string | null;
  cve: string | null;
  rule_id: string | null;
  metadata: string | null;
  created_at: string;
}

export const findingsRepository = new FindingsRepository();
