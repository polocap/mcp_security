import { BaseMcpClient, McpClientOptions, ScanOptions } from './base-client.js';
import { logger } from '../utils/logger.js';
import type { NormalizedFinding, Category, Severity } from '../types/findings.js';

/**
 * MCP Client for Semgrep security scanner
 * Connects to an existing Semgrep MCP server
 */
export class SemgrepClient extends BaseMcpClient {
  constructor(options: Omit<McpClientOptions, 'name'> & { name?: string }) {
    super({ ...options, name: options.name || 'semgrep' });
  }

  protected getCategory(): Category {
    return 'security';
  }

  protected async executeScan(options: ScanOptions): Promise<NormalizedFinding[]> {
    const scanLogger = logger.child('semgrep-scan');
    scanLogger.info(`Scanning ${options.projectPath}`);

    try {
      // Call the semgrep scan tool
      const result = await this.callTool('semgrep_scan', {
        path: options.projectPath,
        config: 'auto', // Use auto config for broad coverage
      });

      // Parse and normalize the results
      return this.normalizeResults(result);
    } catch (error) {
      scanLogger.error(`Scan failed: ${error}`);
      throw error;
    }
  }

  /**
   * Normalize Semgrep results to our standard format
   */
  private normalizeResults(result: unknown): NormalizedFinding[] {
    const findings: NormalizedFinding[] = [];
    const now = new Date().toISOString();

    // Handle different result formats
    if (!result || typeof result !== 'object') {
      return findings;
    }

    // Semgrep typically returns results in this format
    const semgrepResult = result as SemgrepResult;

    if (Array.isArray(semgrepResult.results)) {
      for (const item of semgrepResult.results) {
        findings.push({
          id: `semgrep-${item.check_id}-${item.path}-${item.start?.line || 0}`,
          scanner: 'semgrep',
          category: 'security',
          severity: this.mapSeverity(item.extra?.severity || 'WARNING'),
          title: item.check_id || 'Unknown Rule',
          description: item.extra?.message || item.message || 'No description',
          file: item.path,
          line: item.start?.line,
          column: item.start?.col,
          codeSnippet: item.extra?.lines || undefined,
          remediation: item.extra?.fix || undefined,
          cwe: this.extractCwe(item.extra?.metadata),
          ruleId: item.check_id,
          metadata: {
            fingerprint: item.extra?.fingerprint,
            references: item.extra?.metadata?.references,
            category: item.extra?.metadata?.category,
            technology: item.extra?.metadata?.technology,
          },
          createdAt: now,
        });
      }
    }

    // Also handle if result is directly an array
    if (Array.isArray(result)) {
      for (const item of result) {
        if (item && typeof item === 'object') {
          const finding = item as Record<string, unknown>;
          findings.push({
            id: `semgrep-${finding.rule_id || finding.check_id || 'unknown'}-${finding.path || ''}-${(finding.line as number) || 0}`,
            scanner: 'semgrep',
            category: 'security',
            severity: this.mapSeverity(String(finding.severity || 'medium')),
            title: String(finding.rule_id || finding.check_id || finding.title || 'Unknown'),
            description: String(finding.message || finding.description || 'No description'),
            file: finding.path as string | undefined,
            line: finding.line as number | undefined,
            column: finding.column as number | undefined,
            codeSnippet: finding.code as string | undefined,
            remediation: finding.fix as string | undefined,
            cwe: finding.cwe as string | undefined,
            ruleId: String(finding.rule_id || finding.check_id || ''),
            metadata: finding.metadata as Record<string, unknown> | undefined,
            createdAt: now,
          });
        }
      }
    }

    logger.child('semgrep').info(`Normalized ${findings.length} findings`);
    return findings;
  }

  /**
   * Map Semgrep severity to our severity levels
   */
  private mapSeverity(semgrepSeverity: string): Severity {
    const severity = semgrepSeverity.toUpperCase();
    switch (severity) {
      case 'ERROR':
      case 'CRITICAL':
        return 'critical';
      case 'WARNING':
      case 'HIGH':
        return 'high';
      case 'INFO':
      case 'MEDIUM':
        return 'medium';
      case 'LOW':
        return 'low';
      default:
        return 'info';
    }
  }

  /**
   * Extract CWE from metadata
   */
  private extractCwe(metadata: unknown): string | undefined {
    if (!metadata || typeof metadata !== 'object') {
      return undefined;
    }

    const meta = metadata as Record<string, unknown>;

    // Check various CWE formats
    if (typeof meta.cwe === 'string') {
      return meta.cwe;
    }
    if (Array.isArray(meta.cwe) && meta.cwe.length > 0) {
      return String(meta.cwe[0]);
    }
    if (typeof meta.CWE === 'string') {
      return meta.CWE;
    }

    return undefined;
  }
}

// Semgrep result types
interface SemgrepResult {
  results?: SemgrepFinding[];
  errors?: unknown[];
  version?: string;
}

interface SemgrepFinding {
  check_id?: string;
  path?: string;
  message?: string;
  start?: {
    line?: number;
    col?: number;
  };
  end?: {
    line?: number;
    col?: number;
  };
  extra?: {
    severity?: string;
    message?: string;
    lines?: string;
    fix?: string;
    fingerprint?: string;
    metadata?: {
      cwe?: string | string[];
      references?: string[];
      category?: string;
      technology?: string[];
    };
  };
}
