import { BaseMcpClient, McpClientOptions, ScanOptions } from './base-client.js';
import { logger } from '../utils/logger.js';
import type { NormalizedFinding, Category, Severity } from '../types/findings.js';

/**
 * MCP Client for Trivy vulnerability scanner
 * Handles containers, filesystems, and IaC scanning
 */
export class TrivyClient extends BaseMcpClient {
  constructor(options: Omit<McpClientOptions, 'name'> & { name?: string }) {
    super({ ...options, name: options.name || 'trivy' });
  }

  protected getCategory(): Category {
    return 'security';
  }

  protected async executeScan(options: ScanOptions): Promise<NormalizedFinding[]> {
    const scanLogger = logger.child('trivy-scan');
    scanLogger.info(`Scanning ${options.projectPath}`);

    try {
      // Call the Trivy scan tool - filesystem scan for code projects
      const result = await this.callTool('scan_filesystem', {
        path: options.projectPath,
        scanners: 'vuln,secret,misconfig',
      });

      return this.normalizeResults(result);
    } catch (error) {
      scanLogger.error(`Scan failed: ${error}`);
      throw error;
    }
  }

  /**
   * Normalize Trivy results to our standard format
   */
  private normalizeResults(result: unknown): NormalizedFinding[] {
    const findings: NormalizedFinding[] = [];
    const now = new Date().toISOString();

    if (!result || typeof result !== 'object') {
      return findings;
    }

    const trivyResult = result as TrivyResult;

    // Handle Results array
    if (Array.isArray(trivyResult.Results)) {
      for (const targetResult of trivyResult.Results) {
        const target = targetResult.Target || '';

        // Vulnerabilities
        if (Array.isArray(targetResult.Vulnerabilities)) {
          for (const vuln of targetResult.Vulnerabilities) {
            findings.push({
              id: `trivy-vuln-${vuln.VulnerabilityID}-${target}`,
              scanner: 'trivy',
              category: 'dependencies',
              severity: this.mapSeverity(vuln.Severity),
              title: `${vuln.VulnerabilityID}: ${vuln.PkgName}`,
              description: vuln.Description || vuln.Title || 'Vulnerability detected',
              file: target,
              cve: vuln.VulnerabilityID,
              remediation: vuln.FixedVersion ? `Upgrade to version ${vuln.FixedVersion}` : undefined,
              metadata: {
                pkgName: vuln.PkgName,
                installedVersion: vuln.InstalledVersion,
                fixedVersion: vuln.FixedVersion,
                references: vuln.References,
                cvss: vuln.CVSS,
              },
              createdAt: now,
            });
          }
        }

        // Misconfigurations
        if (Array.isArray(targetResult.Misconfigurations)) {
          for (const misconfig of targetResult.Misconfigurations) {
            findings.push({
              id: `trivy-misconfig-${misconfig.ID}-${target}`,
              scanner: 'trivy',
              category: 'security',
              severity: this.mapSeverity(misconfig.Severity),
              title: misconfig.Title || misconfig.ID || 'Misconfiguration',
              description: misconfig.Description || misconfig.Message || 'Configuration issue detected',
              file: target,
              line: misconfig.CauseMetadata?.StartLine,
              remediation: misconfig.Resolution,
              ruleId: misconfig.ID,
              metadata: {
                type: misconfig.Type,
                query: misconfig.Query,
                primaryUrl: misconfig.PrimaryURL,
                references: misconfig.References,
              },
              createdAt: now,
            });
          }
        }

        // Secrets
        if (Array.isArray(targetResult.Secrets)) {
          for (const secret of targetResult.Secrets) {
            findings.push({
              id: `trivy-secret-${secret.RuleID}-${target}-${secret.StartLine || 0}`,
              scanner: 'trivy',
              category: 'security',
              severity: this.mapSeverity(secret.Severity || 'HIGH'),
              title: secret.Title || 'Secret Detected',
              description: secret.Match ? `Found: ${secret.Match.substring(0, 50)}...` : 'Potential secret in code',
              file: target,
              line: secret.StartLine,
              ruleId: secret.RuleID,
              metadata: {
                category: secret.Category,
                match: secret.Match,
              },
              createdAt: now,
            });
          }
        }
      }
    }

    logger.child('trivy').info(`Normalized ${findings.length} findings`);
    return findings;
  }

  /**
   * Map Trivy severity to our severity levels
   */
  private mapSeverity(trivySeverity?: string): Severity {
    if (!trivySeverity) return 'medium';

    const severity = trivySeverity.toUpperCase();
    switch (severity) {
      case 'CRITICAL':
        return 'critical';
      case 'HIGH':
        return 'high';
      case 'MEDIUM':
        return 'medium';
      case 'LOW':
        return 'low';
      default:
        return 'info';
    }
  }
}

// Trivy result types
interface TrivyResult {
  SchemaVersion?: number;
  ArtifactName?: string;
  ArtifactType?: string;
  Results?: TrivyTargetResult[];
}

interface TrivyTargetResult {
  Target?: string;
  Class?: string;
  Type?: string;
  Vulnerabilities?: TrivyVulnerability[];
  Misconfigurations?: TrivyMisconfiguration[];
  Secrets?: TrivySecret[];
}

interface TrivyVulnerability {
  VulnerabilityID: string;
  PkgName?: string;
  InstalledVersion?: string;
  FixedVersion?: string;
  Title?: string;
  Description?: string;
  Severity?: string;
  References?: string[];
  CVSS?: unknown;
}

interface TrivyMisconfiguration {
  ID?: string;
  Type?: string;
  Title?: string;
  Description?: string;
  Message?: string;
  Query?: string;
  Resolution?: string;
  Severity?: string;
  PrimaryURL?: string;
  References?: string[];
  CauseMetadata?: {
    StartLine?: number;
    EndLine?: number;
  };
}

interface TrivySecret {
  RuleID?: string;
  Category?: string;
  Severity?: string;
  Title?: string;
  StartLine?: number;
  EndLine?: number;
  Match?: string;
}
