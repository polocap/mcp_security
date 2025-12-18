import { BaseMcpClient, McpClientOptions, ScanOptions } from './base-client.js';
import { logger } from '../utils/logger.js';
import type { NormalizedFinding, Category, Severity } from '../types/findings.js';

/**
 * MCP Client for Snyk dependency vulnerability scanner
 */
export class SnykClient extends BaseMcpClient {
  constructor(options: Omit<McpClientOptions, 'name'> & { name?: string }) {
    super({ ...options, name: options.name || 'snyk' });
  }

  protected getCategory(): Category {
    return 'dependencies';
  }

  protected async executeScan(options: ScanOptions): Promise<NormalizedFinding[]> {
    const scanLogger = logger.child('snyk-scan');
    scanLogger.info(`Scanning ${options.projectPath}`);

    try {
      // Call the Snyk test tool
      const result = await this.callTool('test', {
        path: options.projectPath,
      });

      return this.normalizeResults(result);
    } catch (error) {
      scanLogger.error(`Scan failed: ${error}`);
      throw error;
    }
  }

  /**
   * Normalize Snyk results to our standard format
   */
  private normalizeResults(result: unknown): NormalizedFinding[] {
    const findings: NormalizedFinding[] = [];
    const now = new Date().toISOString();

    if (!result || typeof result !== 'object') {
      return findings;
    }

    const snykResult = result as SnykResult;

    // Handle vulnerabilities array
    const vulnerabilities = snykResult.vulnerabilities || [];
    for (const vuln of vulnerabilities) {
      findings.push({
        id: `snyk-${vuln.id}-${vuln.packageName || 'unknown'}`,
        scanner: 'snyk',
        category: 'dependencies',
        severity: this.mapSeverity(vuln.severity),
        title: vuln.title || vuln.id || 'Vulnerability',
        description: vuln.description || 'Dependency vulnerability detected',
        file: vuln.from?.join(' > ') || undefined,
        cve: vuln.identifiers?.CVE?.[0],
        cwe: vuln.identifiers?.CWE?.[0],
        remediation: this.buildRemediation(vuln),
        ruleId: vuln.id,
        metadata: {
          packageName: vuln.packageName,
          version: vuln.version,
          from: vuln.from,
          upgradePath: vuln.upgradePath,
          isUpgradable: vuln.isUpgradable,
          isPatchable: vuln.isPatchable,
          exploit: vuln.exploit,
          cvssScore: vuln.cvssScore,
          publicationTime: vuln.publicationTime,
        },
        createdAt: now,
      });
    }

    // Handle issues (alternative format)
    if (Array.isArray(snykResult.issues)) {
      for (const issue of snykResult.issues) {
        findings.push({
          id: `snyk-${issue.id || 'unknown'}-${issue.pkgName || 'unknown'}`,
          scanner: 'snyk',
          category: 'dependencies',
          severity: this.mapSeverity(issue.severity || issue.issueData?.severity),
          title: issue.issueData?.title || issue.id || 'Issue',
          description: issue.issueData?.description || 'Security issue detected',
          cve: issue.issueData?.identifiers?.CVE?.[0],
          remediation: issue.fixInfo?.fixedIn ? `Fixed in ${issue.fixInfo.fixedIn.join(', ')}` : undefined,
          ruleId: issue.id,
          metadata: {
            pkgName: issue.pkgName,
            pkgVersion: issue.pkgVersion,
            fixInfo: issue.fixInfo,
          },
          createdAt: now,
        });
      }
    }

    logger.child('snyk').info(`Normalized ${findings.length} findings`);
    return findings;
  }

  /**
   * Build remediation advice
   */
  private buildRemediation(vuln: SnykVulnerability): string | undefined {
    const parts: string[] = [];

    if (vuln.isUpgradable && vuln.upgradePath && vuln.upgradePath.length > 0) {
      const targetVersion = vuln.upgradePath[vuln.upgradePath.length - 1];
      parts.push(`Upgrade to ${targetVersion}`);
    }

    if (vuln.isPatchable) {
      parts.push('Patch available via snyk wizard');
    }

    if (vuln.fixedIn && vuln.fixedIn.length > 0) {
      parts.push(`Fixed in version(s): ${vuln.fixedIn.join(', ')}`);
    }

    return parts.length > 0 ? parts.join('. ') : undefined;
  }

  /**
   * Map Snyk severity to our severity levels
   */
  private mapSeverity(snykSeverity?: string): Severity {
    if (!snykSeverity) return 'medium';

    const severity = snykSeverity.toLowerCase();
    switch (severity) {
      case 'critical':
        return 'critical';
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'info';
    }
  }
}

// Snyk result types
interface SnykResult {
  vulnerabilities?: SnykVulnerability[];
  issues?: SnykIssue[];
  ok?: boolean;
  dependencyCount?: number;
  packageManager?: string;
}

interface SnykVulnerability {
  id?: string;
  title?: string;
  description?: string;
  severity?: string;
  packageName?: string;
  version?: string;
  from?: string[];
  upgradePath?: string[];
  isUpgradable?: boolean;
  isPatchable?: boolean;
  fixedIn?: string[];
  exploit?: string;
  cvssScore?: number;
  publicationTime?: string;
  identifiers?: {
    CVE?: string[];
    CWE?: string[];
  };
}

interface SnykIssue {
  id?: string;
  pkgName?: string;
  pkgVersion?: string;
  severity?: string;
  issueData?: {
    id?: string;
    title?: string;
    description?: string;
    severity?: string;
    identifiers?: {
      CVE?: string[];
      CWE?: string[];
    };
  };
  fixInfo?: {
    fixedIn?: string[];
    isUpgradable?: boolean;
    isPatchable?: boolean;
  };
}
