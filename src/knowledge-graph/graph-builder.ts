import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { logger } from '../utils/logger.js';
import { AstParser } from './ast-parser.js';
import { javascriptParser, typescriptParser } from './languages/javascript-parser.js';
import { pythonParser } from './languages/python-parser.js';
import { graphRepository } from '../storage/repositories/graph.js';
import type { CodeGraph, GraphNode, AstExtractionResult } from '../types/graph.js';

const builderLogger = logger.child('graph-builder');

export interface GraphBuilderOptions {
  analysisId: string;
  projectPath: string;
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFileSize?: number; // bytes
  maxFiles?: number;
}

export class GraphBuilder {
  private parser: AstParser;
  private defaultExcludePatterns = [
    'node_modules',
    '.git',
    '__pycache__',
    '.pytest_cache',
    'dist',
    'build',
    '.next',
    'coverage',
    '.venv',
    'venv',
    'vendor',
  ];

  constructor() {
    this.parser = new AstParser();
    // Register language parsers
    this.parser.registerLanguage(javascriptParser);
    this.parser.registerLanguage(typescriptParser);
    this.parser.registerLanguage(pythonParser);
    builderLogger.info('GraphBuilder initialized with JS, TS, Python parsers');
  }

  async buildGraph(options: GraphBuilderOptions): Promise<CodeGraph> {
    builderLogger.info(`Building knowledge graph for ${options.projectPath}`);
    builderLogger.info(`Analysis ID: ${options.analysisId}`);

    const startTime = Date.now();

    // Clear any existing graph data for this analysis
    graphRepository.deleteByAnalysisId(options.analysisId);

    // Find all files to analyze
    const files = this.findFiles(options);
    builderLogger.info(`Found ${files.length} files to analyze`);

    // Parse each file
    const allResults: AstExtractionResult[] = [];
    let processedCount = 0;
    let errorCount = 0;

    for (const filePath of files) {
      try {
        const content = readFileSync(filePath, 'utf-8');
        const relativePath = relative(options.projectPath, filePath);
        const result = await this.parser.parseFile(relativePath, content);
        allResults.push(result);
        processedCount++;

        if (result.errors.length > 0) {
          builderLogger.warn(`Parse errors in ${relativePath}: ${result.errors.join(', ')}`);
          errorCount++;
        }

        if (processedCount % 50 === 0) {
          builderLogger.debug(`Processed ${processedCount}/${files.length} files`);
        }
      } catch (error) {
        errorCount++;
        builderLogger.error(`Error processing ${filePath}: ${error}`);
      }
    }

    builderLogger.info(`Parsed ${processedCount} files (${errorCount} with errors)`);

    // Create nodes in database
    const nodeInputs = allResults.flatMap((result) =>
      result.nodes.map((node) => ({
        analysisId: options.analysisId,
        type: node.type,
        name: node.name,
        file: node.file,
        lineStart: node.lineStart,
        lineEnd: node.lineEnd,
        metadata: node.metadata,
      }))
    );

    builderLogger.info(`Creating ${nodeInputs.length} nodes in database`);
    const createdNodes = graphRepository.createNodes(nodeInputs);

    // Build a map of name -> node ID for edge resolution
    const nodeMap = new Map<string, GraphNode>();
    for (const node of createdNodes) {
      // Key by name and optionally by file:name for more precise matching
      nodeMap.set(node.name, node);
      if (node.file) {
        nodeMap.set(`${node.file}:${node.name}`, node);
      }
    }
    builderLogger.debug(`Built node map with ${nodeMap.size} entries`);

    // Resolve and create edges
    const edgeInputs: Array<{
      analysisId: string;
      sourceId: string;
      targetId: string;
      type: 'imports' | 'calls' | 'inherits' | 'implements' | 'uses' | 'defines' | 'contains' | 'depends_on';
      metadata?: Record<string, unknown>;
    }> = [];

    for (const result of allResults) {
      for (const edge of result.edges) {
        // Resolve source and target
        const sourceNode = nodeMap.get(edge.sourceId) || nodeMap.get(`${result.file}:${edge.sourceId}`);
        const targetNode = nodeMap.get(edge.targetId) || nodeMap.get(`${result.file}:${edge.targetId}`);

        if (sourceNode && targetNode) {
          edgeInputs.push({
            analysisId: options.analysisId,
            sourceId: sourceNode.id,
            targetId: targetNode.id,
            type: edge.type,
            metadata: edge.metadata,
          });
        } else {
          // Create edge with unresolved reference if source exists
          if (sourceNode) {
            // Create a placeholder node for external references
            const externalNode = graphRepository.createNode({
              analysisId: options.analysisId,
              type: 'module',
              name: edge.targetId,
              metadata: { external: true },
            });
            nodeMap.set(edge.targetId, externalNode);
            edgeInputs.push({
              analysisId: options.analysisId,
              sourceId: sourceNode.id,
              targetId: externalNode.id,
              type: edge.type,
              metadata: { ...edge.metadata, unresolvedTarget: true },
            });
          }
        }
      }
    }

    builderLogger.info(`Creating ${edgeInputs.length} edges in database`);
    if (edgeInputs.length > 0) {
      graphRepository.createEdges(edgeInputs);
    }

    const duration = Date.now() - startTime;
    builderLogger.success(`Graph built in ${duration}ms`);

    // Return the full graph
    return graphRepository.getFullGraph(options.analysisId);
  }

  private findFiles(options: GraphBuilderOptions): string[] {
    const files: string[] = [];
    const excludePatterns = [...this.defaultExcludePatterns, ...(options.excludePatterns || [])];
    const supportedExtensions = this.parser.getSupportedExtensions();
    const maxFileSize = options.maxFileSize || 1024 * 1024; // 1MB default
    const maxFiles = options.maxFiles || 5000;

    builderLogger.debug(`Supported extensions: ${supportedExtensions.join(', ')}`);
    builderLogger.debug(`Exclude patterns: ${excludePatterns.join(', ')}`);

    const walkDir = (dir: string) => {
      if (files.length >= maxFiles) return;

      try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (files.length >= maxFiles) break;

          const fullPath = join(dir, entry);

          // Check exclusions
          if (excludePatterns.some((p) => entry === p || fullPath.includes(p))) {
            continue;
          }

          try {
            const stat = statSync(fullPath);

            if (stat.isDirectory()) {
              walkDir(fullPath);
            } else if (stat.isFile()) {
              // Check extension
              const ext = '.' + entry.split('.').pop();
              if (!supportedExtensions.includes(ext)) continue;

              // Check file size
              if (stat.size > maxFileSize) {
                builderLogger.debug(`Skipping large file: ${fullPath} (${stat.size} bytes)`);
                continue;
              }

              files.push(fullPath);
            }
          } catch (statError) {
            builderLogger.debug(`Cannot stat ${fullPath}: ${statError}`);
          }
        }
      } catch (readError) {
        builderLogger.debug(`Cannot read directory ${dir}: ${readError}`);
      }
    };

    walkDir(options.projectPath);

    if (files.length >= maxFiles) {
      builderLogger.warn(`Reached max files limit (${maxFiles}), some files may be skipped`);
    }

    return files;
  }
}

// Singleton instance
let graphBuilderInstance: GraphBuilder | null = null;

export function getGraphBuilder(): GraphBuilder {
  if (!graphBuilderInstance) {
    graphBuilderInstance = new GraphBuilder();
  }
  return graphBuilderInstance;
}
