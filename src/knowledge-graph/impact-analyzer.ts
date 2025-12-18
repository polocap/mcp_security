import { logger } from '../utils/logger.js';
import { graphRepository } from '../storage/repositories/graph.js';
import { findingsRepository } from '../storage/repositories/findings.js';
import type { GraphNode, GraphEdge, ImpactAnalysisResult, CodeGraph } from '../types/graph.js';
import type { NormalizedFinding } from '../types/findings.js';

const impactLogger = logger.child('impact-analyzer');

export interface ImpactAnalyzerOptions {
  analysisId: string;
  maxDepth?: number; // Maximum depth for transitive dependency search
}

export class ImpactAnalyzer {
  private graph: CodeGraph | null = null;
  private nodeIndex: Map<string, GraphNode> = new Map();
  private incomingEdgeIndex: Map<string, GraphEdge[]> = new Map();
  private outgoingEdgeIndex: Map<string, GraphEdge[]> = new Map();
  private fileNodeIndex: Map<string, GraphNode[]> = new Map();

  async loadGraph(analysisId: string): Promise<void> {
    impactLogger.info(`Loading graph for analysis ${analysisId}`);
    this.graph = graphRepository.getFullGraph(analysisId);

    // Build indexes for fast lookups
    this.nodeIndex.clear();
    this.incomingEdgeIndex.clear();
    this.outgoingEdgeIndex.clear();
    this.fileNodeIndex.clear();

    for (const node of this.graph.nodes) {
      this.nodeIndex.set(node.id, node);

      // Index by file
      if (node.file) {
        const fileNodes = this.fileNodeIndex.get(node.file) || [];
        fileNodes.push(node);
        this.fileNodeIndex.set(node.file, fileNodes);
      }
    }

    for (const edge of this.graph.edges) {
      // Incoming edges (what points TO this node)
      const incoming = this.incomingEdgeIndex.get(edge.targetId) || [];
      incoming.push(edge);
      this.incomingEdgeIndex.set(edge.targetId, incoming);

      // Outgoing edges (what this node points TO)
      const outgoing = this.outgoingEdgeIndex.get(edge.sourceId) || [];
      outgoing.push(edge);
      this.outgoingEdgeIndex.set(edge.sourceId, outgoing);
    }

    impactLogger.info(`Graph loaded: ${this.graph.nodes.length} nodes, ${this.graph.edges.length} edges`);
    impactLogger.debug(`File index: ${this.fileNodeIndex.size} files`);
  }

  analyzeFileImpact(
    analysisId: string,
    targetFile: string,
    targetFunction?: string,
    maxDepth = 5
  ): ImpactAnalysisResult {
    impactLogger.info(`Analyzing impact of ${targetFile}${targetFunction ? `:${targetFunction}` : ''}`);

    if (!this.graph || this.graph.analysisId !== analysisId) {
      throw new Error('Graph not loaded or mismatched analysis ID. Call loadGraph first.');
    }

    // Find the target node(s)
    const targetNodes = this.findTargetNodes(targetFile, targetFunction);
    impactLogger.debug(`Found ${targetNodes.length} target nodes`);

    if (targetNodes.length === 0) {
      impactLogger.warn(`No nodes found for ${targetFile}`);
      return {
        targetFile,
        targetFunction,
        directDependents: [],
        transitiveDependents: [],
        affectedFiles: [],
        impactScore: 0,
        vulnerabilityPropagation: [],
      };
    }

    // Find direct dependents (things that directly reference the target)
    const directDependentIds = new Set<string>();
    const directDependentFiles = new Set<string>();

    for (const target of targetNodes) {
      const incoming = this.incomingEdgeIndex.get(target.id) || [];
      for (const edge of incoming) {
        const sourceNode = this.nodeIndex.get(edge.sourceId);
        if (sourceNode && sourceNode.id !== target.id) {
          directDependentIds.add(sourceNode.id);
          if (sourceNode.file) {
            directDependentFiles.add(sourceNode.file);
          }
        }
      }
    }

    impactLogger.debug(`Found ${directDependentIds.size} direct dependents`);

    // Find transitive dependents (BFS)
    const transitiveDependentIds = new Set<string>();
    const transitiveDependentFiles = new Set<string>();
    const visited = new Set<string>(targetNodes.map((n) => n.id));
    const queue: Array<{ nodeId: string; depth: number }> = [];

    // Start from direct dependents
    for (const id of directDependentIds) {
      queue.push({ nodeId: id, depth: 1 });
      visited.add(id);
    }

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;

      if (depth > maxDepth) continue;

      const incoming = this.incomingEdgeIndex.get(nodeId) || [];
      for (const edge of incoming) {
        if (!visited.has(edge.sourceId)) {
          visited.add(edge.sourceId);
          transitiveDependentIds.add(edge.sourceId);

          const sourceNode = this.nodeIndex.get(edge.sourceId);
          if (sourceNode?.file) {
            transitiveDependentFiles.add(sourceNode.file);
          }

          queue.push({ nodeId: edge.sourceId, depth: depth + 1 });
        }
      }
    }

    impactLogger.debug(`Found ${transitiveDependentIds.size} transitive dependents`);

    // Calculate impact score
    const totalNodes = this.graph.nodes.length;
    const affectedNodes = directDependentIds.size + transitiveDependentIds.size;
    const impactScore = totalNodes > 0 ? Math.round((affectedNodes / totalNodes) * 100) : 0;

    // Combine all affected files
    const allAffectedFiles = new Set([...directDependentFiles, ...transitiveDependentFiles]);

    // Check for vulnerability propagation
    const vulnerabilityPropagation = this.traceVulnerabilityPropagation(
      analysisId,
      targetFile,
      [...directDependentFiles]
    );

    const result: ImpactAnalysisResult = {
      targetFile,
      targetFunction,
      directDependents: [...directDependentFiles],
      transitiveDependents: [...transitiveDependentFiles].filter((f) => !directDependentFiles.has(f)),
      affectedFiles: [...allAffectedFiles],
      impactScore,
      vulnerabilityPropagation,
    };

    impactLogger.info(`Impact analysis complete: score=${impactScore}, affected files=${allAffectedFiles.size}`);

    return result;
  }

  private findTargetNodes(targetFile: string, targetFunction?: string): GraphNode[] {
    const fileNodes = this.fileNodeIndex.get(targetFile) || [];

    if (targetFunction) {
      // Find specific function in the file
      return fileNodes.filter(
        (node) => node.type === 'function' && node.name === targetFunction
      );
    }

    // Return all nodes in the file
    return fileNodes;
  }

  private traceVulnerabilityPropagation(
    analysisId: string,
    sourceFile: string,
    dependentFiles: string[]
  ): Array<{ finding: string; propagationPath: string[] }> {
    const propagation: Array<{ finding: string; propagationPath: string[] }> = [];

    try {
      // Get findings for the source file
      const findings = findingsRepository.findByAnalysisId(analysisId, { filePattern: sourceFile });

      for (const finding of findings) {
        if (finding.severity === 'critical' || finding.severity === 'high') {
          // This vulnerability could propagate to dependent files
          propagation.push({
            finding: `${finding.severity.toUpperCase()}: ${finding.title}`,
            propagationPath: [sourceFile, ...dependentFiles.slice(0, 5)],
          });
        }
      }
    } catch (error) {
      impactLogger.warn(`Error tracing vulnerability propagation: ${error}`);
    }

    return propagation;
  }

  // Find dead code (nodes with no incoming edges except from their own module)
  findDeadCode(analysisId: string): GraphNode[] {
    impactLogger.info('Finding dead code...');

    if (!this.graph || this.graph.analysisId !== analysisId) {
      this.loadGraph(analysisId);
    }

    const deadNodes: GraphNode[] = [];

    for (const node of this.graph!.nodes) {
      // Skip modules, imports, exports
      if (node.type === 'module' || node.type === 'import' || node.type === 'export') {
        continue;
      }

      // Skip exported items (they might be used externally)
      if (node.metadata?.exported) {
        continue;
      }

      // Check if anything references this node from a different file
      const incoming = this.incomingEdgeIndex.get(node.id) || [];
      const hasExternalReference = incoming.some((edge) => {
        const sourceNode = this.nodeIndex.get(edge.sourceId);
        return sourceNode && sourceNode.file !== node.file;
      });

      if (!hasExternalReference && incoming.length === 0) {
        deadNodes.push(node);
      }
    }

    impactLogger.info(`Found ${deadNodes.length} potentially dead code items`);
    return deadNodes;
  }

  // Get dependency chain for a node
  getDependencyChain(nodeId: string, maxDepth = 10): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id) || depth > maxDepth) continue;

      visited.add(id);
      const node = this.nodeIndex.get(id);
      if (node) {
        chain.push(`${node.type}:${node.name}${node.file ? ` (${node.file})` : ''}`);
      }

      const outgoing = this.outgoingEdgeIndex.get(id) || [];
      for (const edge of outgoing) {
        queue.push({ id: edge.targetId, depth: depth + 1 });
      }
    }

    return chain;
  }
}

// Singleton
let analyzerInstance: ImpactAnalyzer | null = null;

export function getImpactAnalyzer(): ImpactAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new ImpactAnalyzer();
  }
  return analyzerInstance;
}
