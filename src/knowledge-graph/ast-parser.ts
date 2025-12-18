import Parser from 'tree-sitter';
import { logger } from '../utils/logger.js';
import type { AstExtractionResult, NodeType, EdgeType, GraphNode, GraphEdge } from '../types/graph.js';

const graphLogger = logger.child('ast-parser');

export interface LanguageParser {
  language: string;
  extensions: string[];
  parser: Parser.Language;
  extractNodes: (tree: Parser.Tree, filePath: string) => ExtractedElement[];
  extractEdges: (tree: Parser.Tree, nodes: ExtractedElement[], filePath: string) => ExtractedEdge[];
}

export interface ExtractedElement {
  type: NodeType;
  name: string;
  lineStart: number;
  lineEnd: number;
  metadata?: Record<string, unknown>;
}

export interface ExtractedEdge {
  sourceRef: string; // Reference to source node (e.g., function name)
  targetRef: string; // Reference to target node
  type: EdgeType;
  metadata?: Record<string, unknown>;
}

export class AstParser {
  private parser: Parser;
  private languageParsers: Map<string, LanguageParser> = new Map();

  constructor() {
    this.parser = new Parser();
    graphLogger.debug('AstParser initialized');
  }

  registerLanguage(languageParser: LanguageParser): void {
    for (const ext of languageParser.extensions) {
      this.languageParsers.set(ext, languageParser);
    }
    graphLogger.debug(`Registered parser for ${languageParser.language} (${languageParser.extensions.join(', ')})`);
  }

  getParserForFile(filePath: string): LanguageParser | null {
    const ext = this.getExtension(filePath);
    return this.languageParsers.get(ext) || null;
  }

  private getExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
  }

  async parseFile(filePath: string, content: string): Promise<AstExtractionResult> {
    const languageParser = this.getParserForFile(filePath);

    if (!languageParser) {
      graphLogger.debug(`No parser available for file: ${filePath}`);
      return {
        file: filePath,
        language: 'unknown',
        nodes: [],
        edges: [],
        errors: [`No parser available for file extension: ${this.getExtension(filePath)}`],
      };
    }

    graphLogger.debug(`Parsing file: ${filePath} with ${languageParser.language} parser`);

    try {
      this.parser.setLanguage(languageParser.parser);
      const tree = this.parser.parse(content);

      if (tree.rootNode.hasError) {
        graphLogger.warn(`Parse errors in file: ${filePath}`);
      }

      // Extract nodes
      const extractedElements = languageParser.extractNodes(tree, filePath);
      graphLogger.debug(`Extracted ${extractedElements.length} nodes from ${filePath}`);

      // Extract edges
      const extractedEdges = languageParser.extractEdges(tree, extractedElements, filePath);
      graphLogger.debug(`Extracted ${extractedEdges.length} edges from ${filePath}`);

      // Convert to graph format
      const nodes: Omit<GraphNode, 'id' | 'analysisId' | 'createdAt'>[] = extractedElements.map((el) => ({
        type: el.type,
        name: el.name,
        file: filePath,
        lineStart: el.lineStart,
        lineEnd: el.lineEnd,
        metadata: el.metadata,
      }));

      const edges: Omit<GraphEdge, 'id' | 'analysisId' | 'createdAt'>[] = extractedEdges.map((edge) => ({
        sourceId: edge.sourceRef, // Will be resolved later
        targetId: edge.targetRef,
        type: edge.type,
        metadata: edge.metadata,
      }));

      return {
        file: filePath,
        language: languageParser.language,
        nodes,
        edges,
        errors: tree.rootNode.hasError ? ['Parse errors detected'] : [],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      graphLogger.error(`Error parsing file ${filePath}: ${errorMsg}`);
      return {
        file: filePath,
        language: languageParser.language,
        nodes: [],
        edges: [],
        errors: [errorMsg],
      };
    }
  }

  getSupportedExtensions(): string[] {
    return Array.from(this.languageParsers.keys());
  }
}

// Helper function to traverse tree-sitter nodes
export function traverseTree(
  node: Parser.SyntaxNode,
  callback: (node: Parser.SyntaxNode, depth: number) => void,
  depth = 0
): void {
  callback(node, depth);
  for (const child of node.children) {
    traverseTree(child, callback, depth + 1);
  }
}

// Helper to get node text safely
export function getNodeText(node: Parser.SyntaxNode): string {
  return node.text || '';
}
