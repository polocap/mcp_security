// Knowledge Graph Module
// Provides AST parsing, graph building, and impact analysis

export { AstParser, traverseTree, getNodeText } from './ast-parser.js';
export type { LanguageParser, ExtractedElement, ExtractedEdge } from './ast-parser.js';

export { GraphBuilder, getGraphBuilder } from './graph-builder.js';
export type { GraphBuilderOptions } from './graph-builder.js';

export { ImpactAnalyzer, getImpactAnalyzer } from './impact-analyzer.js';
export type { ImpactAnalyzerOptions } from './impact-analyzer.js';

// Language parsers
export { javascriptParser, typescriptParser } from './languages/javascript-parser.js';
export { pythonParser } from './languages/python-parser.js';
