import { BaseMcpClient, McpClientOptions, ScanOptions } from './base-client.js';
import { logger } from '../utils/logger.js';
import type { NormalizedFinding, Category, Severity } from '../types/findings.js';

/**
 * MCP Client for ESLint code quality scanner
 */
export class EslintClient extends BaseMcpClient {
  constructor(options: Omit<McpClientOptions, 'name'> & { name?: string }) {
    super({ ...options, name: options.name || 'eslint' });
  }

  protected getCategory(): Category {
    return 'quality';
  }

  protected async executeScan(options: ScanOptions): Promise<NormalizedFinding[]> {
    const scanLogger = logger.child('eslint-scan');
    scanLogger.info(`Scanning ${options.projectPath}`);

    try {
      // Call the ESLint scan tool
      const result = await this.callTool('lint', {
        path: options.projectPath,
        fix: false,
      });

      return this.normalizeResults(result);
    } catch (error) {
      scanLogger.error(`Scan failed: ${error}`);
      throw error;
    }
  }

  /**
   * Normalize ESLint results to our standard format
   */
  private normalizeResults(result: unknown): NormalizedFinding[] {
    const findings: NormalizedFinding[] = [];
    const now = new Date().toISOString();

    if (!result || typeof result !== 'object') {
      return findings;
    }

    // ESLint returns array of file results
    const eslintResults = Array.isArray(result) ? result : [result];

    for (const fileResult of eslintResults) {
      const file = fileResult as EslintFileResult;
      const filePath = file.filePath || file.path || '';

      const messages = file.messages || [];
      for (const msg of messages) {
        findings.push({
          id: `eslint-${msg.ruleId || 'unknown'}-${filePath}-${msg.line || 0}`,
          scanner: 'eslint',
          category: 'quality',
          severity: this.mapSeverity(msg.severity),
          title: msg.ruleId || 'ESLint Rule',
          description: msg.message || 'No description',
          file: filePath,
          line: msg.line,
          column: msg.column,
          codeSnippet: msg.source,
          remediation: msg.fix ? 'Auto-fix available' : undefined,
          ruleId: msg.ruleId,
          metadata: {
            endLine: msg.endLine,
            endColumn: msg.endColumn,
            nodeType: msg.nodeType,
            fatal: msg.fatal,
          },
          createdAt: now,
        });
      }
    }

    logger.child('eslint').info(`Normalized ${findings.length} findings`);
    return findings;
  }

  /**
   * Map ESLint severity (1=warn, 2=error) to our severity levels
   */
  private mapSeverity(eslintSeverity: number | string): Severity {
    if (typeof eslintSeverity === 'number') {
      return eslintSeverity >= 2 ? 'high' : 'medium';
    }
    const sev = String(eslintSeverity).toLowerCase();
    if (sev === 'error' || sev === '2') return 'high';
    if (sev === 'warning' || sev === 'warn' || sev === '1') return 'medium';
    return 'low';
  }
}

interface EslintFileResult {
  filePath?: string;
  path?: string;
  messages?: EslintMessage[];
  errorCount?: number;
  warningCount?: number;
}

interface EslintMessage {
  ruleId?: string;
  severity: number | string;
  message?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  source?: string;
  nodeType?: string;
  fatal?: boolean;
  fix?: unknown;
}
