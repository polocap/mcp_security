import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { AnalysisRequestSchema } from '../types/config.js';
import { Orchestrator } from '../orchestrator/index.js';
import { projectsRepository } from '../storage/repositories/projects.js';
import { analysesRepository } from '../storage/repositories/analyses.js';
import { findingsRepository } from '../storage/repositories/findings.js';
import { getDatabase } from '../storage/database.js';
import type { Analysis, Project } from '../types/analysis.js';
import type { NormalizedFinding } from '../types/findings.js';

const SERVER_NAME = 'mcp-code-analyzer';
const SERVER_VERSION = '0.1.0';

export class McpAnalyzerServer {
  private server: Server;
  private config;
  private orchestrator: Orchestrator;

  constructor() {
    this.config = loadConfig();
    // Initialize database
    getDatabase();
    // Create orchestrator
    this.orchestrator = new Orchestrator({ config: this.config });
    this.server = new Server(
      {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'analyze_project',
            description: 'Analyze a code project for security, quality, dependencies, and architecture issues',
            inputSchema: {
              type: 'object' as const,
              properties: {
                source: {
                  type: 'string',
                  description: 'Path to local project or Git URL',
                },
                scanners: {
                  type: 'array',
                  items: { type: 'string', enum: ['security', 'quality', 'dependencies', 'architecture'] },
                  description: 'Which scanners to run (default: all enabled)',
                },
                languages: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Languages to analyze (default: auto-detect)',
                },
                branch: {
                  type: 'string',
                  description: 'Git branch to analyze (for Git URLs)',
                },
              },
              required: ['source'],
            },
          },
          {
            name: 'get_analysis_report',
            description: 'Get a detailed report for a completed analysis',
            inputSchema: {
              type: 'object' as const,
              properties: {
                analysis_id: {
                  type: 'string',
                  description: 'The analysis ID',
                },
                format: {
                  type: 'string',
                  enum: ['json', 'markdown', 'summary'],
                  description: 'Report format (default: json)',
                },
                include_findings: {
                  type: 'boolean',
                  description: 'Include detailed findings (default: true)',
                },
              },
              required: ['analysis_id'],
            },
          },
          {
            name: 'compare_analyses',
            description: 'Compare two analyses to see score changes and new/fixed issues',
            inputSchema: {
              type: 'object' as const,
              properties: {
                analysis_id_1: {
                  type: 'string',
                  description: 'First analysis ID (older)',
                },
                analysis_id_2: {
                  type: 'string',
                  description: 'Second analysis ID (newer)',
                },
              },
              required: ['analysis_id_1', 'analysis_id_2'],
            },
          },
          {
            name: 'list_project_analyses',
            description: 'List all analyses for a project with trend data',
            inputSchema: {
              type: 'object' as const,
              properties: {
                project_path: {
                  type: 'string',
                  description: 'Project path or identifier',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of analyses to return (default: 10)',
                },
              },
              required: ['project_path'],
            },
          },
          {
            name: 'get_findings',
            description: 'Get specific findings filtered by severity, category, or file',
            inputSchema: {
              type: 'object' as const,
              properties: {
                analysis_id: {
                  type: 'string',
                  description: 'The analysis ID',
                },
                severity: {
                  type: 'string',
                  enum: ['critical', 'high', 'medium', 'low', 'info'],
                  description: 'Filter by severity',
                },
                category: {
                  type: 'string',
                  enum: ['security', 'quality', 'dependencies', 'architecture'],
                  description: 'Filter by category',
                },
                file_pattern: {
                  type: 'string',
                  description: 'Filter by file pattern (glob)',
                },
              },
              required: ['analysis_id'],
            },
          },
          {
            name: 'get_code_graph',
            description: 'Get the semantic code graph for a project (modules, functions, dependencies)',
            inputSchema: {
              type: 'object' as const,
              properties: {
                analysis_id: {
                  type: 'string',
                  description: 'The analysis ID',
                },
                include_edges: {
                  type: 'boolean',
                  description: 'Include relationship edges (default: true)',
                },
              },
              required: ['analysis_id'],
            },
          },
          {
            name: 'analyze_impact',
            description: 'Analyze the impact of changes to a specific file or function',
            inputSchema: {
              type: 'object' as const,
              properties: {
                analysis_id: {
                  type: 'string',
                  description: 'The analysis ID',
                },
                file: {
                  type: 'string',
                  description: 'File path to analyze impact for',
                },
                function_name: {
                  type: 'string',
                  description: 'Function name to analyze impact for',
                },
              },
              required: ['analysis_id', 'file'],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      logger.info(`Tool called: ${name}`, args);

      try {
        switch (name) {
          case 'analyze_project': {
            const validatedArgs = AnalysisRequestSchema.parse(args);
            const result = await this.orchestrator.analyze({
              source: validatedArgs.source,
              scanners: validatedArgs.scanners,
              languages: validatedArgs.languages,
              branch: validatedArgs.branch,
            });
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    analysis_id: result.analysis.id,
                    status: result.analysis.status,
                    scores: result.analysis.scores,
                    grade: result.analysis.scores?.grade || null,
                    findings_summary: {
                      total: result.findings.length,
                      by_severity: this.groupBySeverity(result.findings),
                      by_category: this.groupByCategory(result.findings),
                    },
                    duration_ms: result.analysis.durationMs,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_analysis_report': {
            const { analysis_id, format = 'json', include_findings = true } = args as {
              analysis_id: string;
              format?: 'json' | 'markdown' | 'summary';
              include_findings?: boolean;
            };

            const analysis = analysesRepository.findById(analysis_id);
            if (!analysis) {
              throw new Error(`Analysis not found: ${analysis_id}`);
            }

            const findings = include_findings
              ? findingsRepository.findByAnalysisId(analysis_id)
              : [];

            const project = projectsRepository.findById(analysis.projectId);

            const report = this.formatReport({ analysis, findings, project }, format);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: report,
                },
              ],
            };
          }

          case 'compare_analyses': {
            const { analysis_id_1, analysis_id_2 } = args as {
              analysis_id_1: string;
              analysis_id_2: string;
            };

            const analysis1 = analysesRepository.findById(analysis_id_1);
            const analysis2 = analysesRepository.findById(analysis_id_2);

            if (!analysis1 || !analysis2) {
              throw new Error('One or both analyses not found');
            }

            const findings1 = findingsRepository.findByAnalysisId(analysis_id_1);
            const findings2 = findingsRepository.findByAnalysisId(analysis_id_2);

            const comparison = this.compareAnalyses(analysis1, analysis2, findings1, findings2);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(comparison, null, 2),
                },
              ],
            };
          }

          case 'list_project_analyses': {
            const { project_path, limit = 10 } = args as {
              project_path: string;
              limit?: number;
            };

            const project = projectsRepository.findByPath(project_path);
            if (!project) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({ analyses: [], message: 'Project not found' }, null, 2),
                  },
                ],
              };
            }

            const analyses = analysesRepository.findByProjectId(project.id, limit);
            const analysesList = analyses.map((a) => ({
              id: a.id,
              status: a.status,
              started_at: a.startedAt,
              completed_at: a.completedAt,
              scores: a.scores ? {
                overall: a.scores.overall,
                security: a.scores.security,
                quality: a.scores.quality,
                dependencies: a.scores.dependencies,
                architecture: a.scores.architecture,
              } : null,
              grade: a.scores?.grade || null,
            }));

            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    project: { id: project.id, name: project.name, path: project.path },
                    analyses: analysesList,
                    total: analysesList.length,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_findings': {
            const { analysis_id, severity, category, file_pattern } = args as {
              analysis_id: string;
              severity?: string;
              category?: string;
              file_pattern?: string;
            };

            const findings = findingsRepository.findByAnalysisId(analysis_id, {
              severity: severity as 'critical' | 'high' | 'medium' | 'low' | 'info' | undefined,
              category: category as 'security' | 'quality' | 'dependencies' | 'architecture' | undefined,
              filePattern: file_pattern,
            });

            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    analysis_id,
                    filters: { severity, category, file_pattern },
                    findings,
                    total: findings.length,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_code_graph': {
            const { analysis_id, include_edges = true } = args as { analysis_id: string; include_edges?: boolean };
            logger.info(`Getting code graph for analysis ${analysis_id}`);

            // Check if graph exists, if not build it
            let graph = this.orchestrator.getGraph(analysis_id);
            if (graph.nodes.length === 0) {
              logger.info('Graph not found, building...');
              graph = await this.orchestrator.buildGraph(analysis_id);
            }

            const result = {
              analysis_id,
              stats: graph.stats,
              nodes: graph.nodes.map(n => ({
                id: n.id,
                type: n.type,
                name: n.name,
                file: n.file,
                line_start: n.lineStart,
                line_end: n.lineEnd,
              })),
              edges: include_edges ? graph.edges.map(e => ({
                id: e.id,
                source_id: e.sourceId,
                target_id: e.targetId,
                type: e.type,
              })) : undefined,
            };

            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'analyze_impact': {
            const { analysis_id, file, function_name } = args as {
              analysis_id: string;
              file: string;
              function_name?: string;
            };
            logger.info(`Analyzing impact for ${file}${function_name ? `:${function_name}` : ''}`);

            const result = await this.orchestrator.analyzeImpact(analysis_id, file, function_name);

            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    target_file: result.targetFile,
                    target_function: result.targetFunction,
                    impact_score: result.impactScore,
                    direct_dependents: result.directDependents,
                    transitive_dependents: result.transitiveDependents,
                    affected_files_count: result.affectedFiles.length,
                    affected_files: result.affectedFiles.slice(0, 50), // Limit to 50
                    vulnerability_propagation: result.vulnerabilityPropagation,
                  }, null, 2),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        logger.error(`Tool error: ${name}`, error);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        };
      }
    });

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: 'analysis://latest',
            name: 'Latest Analysis',
            description: 'The most recent analysis result',
            mimeType: 'application/json',
          },
        ],
      };
    });

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      logger.info(`Resource requested: ${uri}`);

      // TODO: Implement resource reading
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ status: 'not_implemented' }),
          },
        ],
      };
    });
  }

  private groupBySeverity(findings: Array<{ severity: string }>): Record<string, number> {
    const groups: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    for (const f of findings) {
      const sev = f.severity;
      if (sev && Object.prototype.hasOwnProperty.call(groups, sev)) {
        groups[sev] = (groups[sev] ?? 0) + 1;
      }
    }
    return groups;
  }

  private groupByCategory(findings: Array<{ category: string }>): Record<string, number> {
    const groups: Record<string, number> = {
      security: 0,
      quality: 0,
      dependencies: 0,
      architecture: 0,
    };
    for (const f of findings) {
      const cat = f.category;
      if (cat && Object.prototype.hasOwnProperty.call(groups, cat)) {
        groups[cat] = (groups[cat] ?? 0) + 1;
      }
    }
    return groups;
  }

  private formatReport(
    data: { analysis: Analysis | null; findings: NormalizedFinding[]; project: Project | null },
    format: 'json' | 'markdown' | 'summary'
  ): string {
    const { analysis, findings, project } = data;

    if (format === 'summary') {
      return JSON.stringify({
        analysis_id: analysis?.id,
        project: project,
        status: analysis?.status,
        grade: analysis?.scores?.grade || null,
        scores: analysis?.scores ? {
          overall: analysis.scores.overall,
          security: analysis.scores.security,
          quality: analysis.scores.quality,
          dependencies: analysis.scores.dependencies,
          architecture: analysis.scores.architecture,
        } : null,
        findings_count: findings.length,
      }, null, 2);
    }

    if (format === 'markdown') {
      const lines = [
        `# Analysis Report`,
        ``,
        `## Project: ${project?.name || 'Unknown'}`,
        `**Path:** ${project?.path || 'N/A'}`,
        `**Analysis ID:** ${analysis?.id}`,
        `**Grade:** ${analysis?.scores?.grade || 'N/A'}`,
        ``,
        `## Scores`,
        `| Category | Score |`,
        `|----------|-------|`,
        `| Overall | ${analysis?.scores?.overall ?? 'N/A'} |`,
        `| Security | ${analysis?.scores?.security ?? 'N/A'} |`,
        `| Quality | ${analysis?.scores?.quality ?? 'N/A'} |`,
        `| Dependencies | ${analysis?.scores?.dependencies ?? 'N/A'} |`,
        `| Architecture | ${analysis?.scores?.architecture ?? 'N/A'} |`,
        ``,
        `## Findings (${findings.length} total)`,
      ];

      const bySeverity = this.groupBySeverity(findings);
      lines.push(`- Critical: ${bySeverity.critical}`);
      lines.push(`- High: ${bySeverity.high}`);
      lines.push(`- Medium: ${bySeverity.medium}`);
      lines.push(`- Low: ${bySeverity.low}`);
      lines.push(`- Info: ${bySeverity.info}`);

      if (findings.length > 0) {
        lines.push(``, `### Top Issues`);
        const topFindings = findings.slice(0, 10);
        for (const f of topFindings) {
          lines.push(`- **[${f.severity.toUpperCase()}]** ${f.title}${f.file ? ` (${f.file}:${f.line || 0})` : ''}`);
        }
      }

      return lines.join('\n');
    }

    // Default: JSON format
    return JSON.stringify({ analysis, project, findings }, null, 2);
  }

  private compareAnalyses(
    analysis1: Analysis,
    analysis2: Analysis,
    findings1: NormalizedFinding[],
    findings2: NormalizedFinding[]
  ): object {
    const scoreDiff = (a: number | null | undefined, b: number | null | undefined) => {
      if (a === null || a === undefined || b === null || b === undefined) return null;
      return b - a;
    };

    const f1Ids = new Set(findings1.map(f => `${f.ruleId}:${f.file}`));
    const f2Ids = new Set(findings2.map(f => `${f.ruleId}:${f.file}`));

    const newIssues = findings2.filter(f => !f1Ids.has(`${f.ruleId}:${f.file}`));
    const fixedIssues = findings1.filter(f => !f2Ids.has(`${f.ruleId}:${f.file}`));

    return {
      analysis_1: { id: analysis1.id, date: analysis1.startedAt, grade: analysis1.scores?.grade || null },
      analysis_2: { id: analysis2.id, date: analysis2.startedAt, grade: analysis2.scores?.grade || null },
      score_changes: {
        overall: scoreDiff(analysis1.scores?.overall, analysis2.scores?.overall),
        security: scoreDiff(analysis1.scores?.security, analysis2.scores?.security),
        quality: scoreDiff(analysis1.scores?.quality, analysis2.scores?.quality),
        dependencies: scoreDiff(analysis1.scores?.dependencies, analysis2.scores?.dependencies),
        architecture: scoreDiff(analysis1.scores?.architecture, analysis2.scores?.architecture),
      },
      findings_summary: {
        analysis_1_count: findings1.length,
        analysis_2_count: findings2.length,
        new_issues: newIssues.length,
        fixed_issues: fixedIssues.length,
      },
      new_issues: newIssues.slice(0, 20),
      fixed_issues: fixedIssues.slice(0, 20),
    };
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info(`${SERVER_NAME} v${SERVER_VERSION} started`);
  }
}

export async function startMcpServer(): Promise<void> {
  const server = new McpAnalyzerServer();
  await server.start();
}

// Auto-start when run directly
startMcpServer().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
