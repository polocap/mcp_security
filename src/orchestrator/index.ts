import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { loadConfig, getServersByLayer } from '../utils/config.js';
import { McpClientRegistry } from '../mcp-clients/registry.js';
import { ScoreCalculator } from '../scoring/score-calculator.js';
import { projectsRepository } from '../storage/repositories/projects.js';
import { analysesRepository } from '../storage/repositories/analyses.js';
import { findingsRepository } from '../storage/repositories/findings.js';
import type { Config, AnalysisRequest } from '../types/config.js';
import type { Analysis, AnalysisResult, Project } from '../types/analysis.js';
import type { ScannerResult, NormalizedFinding, Category } from '../types/findings.js';
import type { AggregateScore } from '../types/scores.js';
import { basename } from 'path';

export interface OrchestratorOptions {
  config?: Config;
}

export class Orchestrator {
  private config: Config;
  private clientRegistry: McpClientRegistry;
  private scoreCalculator: ScoreCalculator;

  constructor(options: OrchestratorOptions = {}) {
    this.config = options.config || loadConfig();
    this.clientRegistry = new McpClientRegistry(this.config);
    this.scoreCalculator = new ScoreCalculator(this.config.scoring);
  }

  /**
   * Run a complete analysis on a project
   */
  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const analysisLogger = logger.child('orchestrator');
    analysisLogger.info(`Starting analysis for: ${request.source}`);

    // Get or create project
    const project = await this.getOrCreateProject(request.source);
    analysisLogger.debug(`Project ID: ${project.id}`);

    // Create analysis record
    const analysis = analysesRepository.create({
      projectId: project.id,
      gitBranch: request.branch,
      config: request as Record<string, unknown>,
    });
    analysisLogger.debug(`Analysis ID: ${analysis.id}`);

    try {
      // Run scans by layer
      const allResults = await this.runScansByLayer(request, project.path);

      // Collect all findings
      const allFindings: NormalizedFinding[] = [];
      const scannersRun: string[] = [];
      const scannersFailed: string[] = [];

      for (const result of allResults) {
        scannersRun.push(result.scanner);
        if (result.status === 'success') {
          allFindings.push(...result.findings);
        } else {
          scannersFailed.push(result.scanner);
        }
      }

      // Save findings to database
      if (allFindings.length > 0) {
        const findingsWithAnalysisId = allFindings.map((f) => ({
          ...f,
          analysisId: analysis.id,
        }));
        findingsRepository.createMany(findingsWithAnalysisId);
      }

      // Calculate scores
      const scores = this.scoreCalculator.calculateAggregateScore(allFindings, allResults);

      // Check for previous score to calculate trend
      const previousAnalysis = analysesRepository.findLatestByProjectId(project.id);
      if (previousAnalysis?.scores) {
        scores.trend = this.scoreCalculator.calculateTrend(
          scores.overall,
          previousAnalysis.scores.overall
        );
      }

      // Update analysis with results
      const completedAnalysis = analysesRepository.complete(
        analysis.id,
        scores,
        scannersRun,
        scannersFailed
      );

      // Update project
      projectsRepository.updateLastAnalyzed(project.id);

      // Get findings summary
      const summary = findingsRepository.getSummaryByAnalysisId(analysis.id);

      analysisLogger.success(
        `Analysis completed: Score ${scores.overall} (${scores.grade}), ${allFindings.length} findings`
      );

      return {
        analysis: completedAnalysis!,
        project,
        findings: allFindings,
        summary,
      };
    } catch (error) {
      // Mark analysis as failed
      const errorMessage = error instanceof Error ? error.message : String(error);
      analysesRepository.fail(analysis.id, errorMessage, [], []);
      analysisLogger.error(`Analysis failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Run scans organized by layer
   */
  private async runScansByLayer(
    request: AnalysisRequest,
    projectPath: string
  ): Promise<ScannerResult[]> {
    const allResults: ScannerResult[] = [];
    const maxLayer = 5;

    for (let layer = 1; layer <= maxLayer; layer++) {
      const serversInLayer = getServersByLayer(this.config, layer);

      if (serversInLayer.length === 0) {
        continue;
      }

      logger.debug(`Running layer ${layer} scanners: ${serversInLayer.join(', ')}`);

      // Filter by requested scanners if specified
      const filteredServers = request.scanners
        ? serversInLayer.filter((name) => {
            const serverConfig = this.config.servers[name];
            return serverConfig && request.scanners?.includes(serverConfig.category as Category);
          })
        : serversInLayer;

      if (filteredServers.length === 0) {
        continue;
      }

      // Run scanners in this layer in parallel
      const layerResults = await this.runScannersInParallel(filteredServers, projectPath, request);
      allResults.push(...layerResults);
    }

    return allResults;
  }

  /**
   * Run multiple scanners in parallel
   */
  private async runScannersInParallel(
    serverNames: string[],
    projectPath: string,
    request: AnalysisRequest
  ): Promise<ScannerResult[]> {
    const results = await Promise.allSettled(
      serverNames.map(async (name) => {
        const client = this.clientRegistry.getClient(name);
        if (!client) {
          const serverCategory = this.config.servers[name]?.category;
          // Filter out 'repos' category as it's not a finding category
          const category = (serverCategory && serverCategory !== 'repos' ? serverCategory : 'security') as Category;
          return {
            scanner: name,
            category,
            status: 'skipped' as const,
            findings: [],
            durationMs: 0,
            error: 'Client not available',
          };
        }

        return client.scan({
          projectPath,
          languages: request.languages,
        });
      })
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      const serverName = serverNames[index] || 'unknown';
      const serverCategory = this.config.servers[serverName]?.category;
      const category = (serverCategory && serverCategory !== 'repos' ? serverCategory : 'security') as Category;
      return {
        scanner: serverName,
        category,
        status: 'failed' as const,
        findings: [],
        durationMs: 0,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      } satisfies ScannerResult;
    });
  }

  /**
   * Get or create a project from a source path/URL
   */
  private async getOrCreateProject(source: string): Promise<Project> {
    // Determine project name from source
    const name = this.extractProjectName(source);

    // Check if project exists
    const existing = projectsRepository.findByPath(source);
    if (existing) {
      return existing;
    }

    // Create new project
    return projectsRepository.create({
      path: source,
      name,
      detectedLanguages: [], // Will be updated after analysis
    });
  }

  /**
   * Extract project name from source path/URL
   */
  private extractProjectName(source: string): string {
    // GitHub URL
    if (source.includes('github.com')) {
      const match = source.match(/github\.com\/[\w-]+\/([\w.-]+)/);
      if (match) {
        return match[1]?.replace(/\.git$/, '') || 'unknown';
      }
    }

    // Local path
    return basename(source) || 'unknown';
  }

  /**
   * Get analysis by ID
   */
  getAnalysis(analysisId: string): Analysis | null {
    return analysesRepository.findById(analysisId);
  }

  /**
   * Get analysis with full details
   */
  getAnalysisResult(analysisId: string): AnalysisResult | null {
    const analysis = analysesRepository.findById(analysisId);
    if (!analysis) {
      return null;
    }

    const project = projectsRepository.findById(analysis.projectId);
    if (!project) {
      return null;
    }

    const findings = findingsRepository.findByAnalysisId(analysisId);
    const summary = findingsRepository.getSummaryByAnalysisId(analysisId);

    return { analysis, project, findings, summary };
  }

  /**
   * Disconnect all clients (cleanup)
   */
  async shutdown(): Promise<void> {
    await this.clientRegistry.disconnectAll();
  }
}

// Singleton orchestrator instance
let orchestratorInstance: Orchestrator | null = null;

export function getOrchestrator(options?: OrchestratorOptions): Orchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new Orchestrator(options);
  }
  return orchestratorInstance;
}
