import { z } from 'zod';

// Node types in the knowledge graph
export const NodeTypeSchema = z.enum([
  'module',      // File/module
  'class',       // Class definition
  'function',    // Function/method definition
  'variable',    // Variable/constant
  'import',      // Import statement
  'export',      // Export statement
]);
export type NodeType = z.infer<typeof NodeTypeSchema>;

// Edge types (relationships)
export const EdgeTypeSchema = z.enum([
  'imports',     // Module imports another module
  'calls',       // Function calls another function
  'inherits',    // Class inherits from another class
  'implements',  // Class implements an interface
  'uses',        // Uses a variable/constant
  'defines',     // Module defines a class/function
  'contains',    // Class contains a method
  'depends_on',  // General dependency
]);
export type EdgeType = z.infer<typeof EdgeTypeSchema>;

// Graph node schema
export const GraphNodeSchema = z.object({
  id: z.string(),
  analysisId: z.string(),
  type: NodeTypeSchema,
  name: z.string(),
  file: z.string().optional(),
  lineStart: z.number().optional(),
  lineEnd: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

// Graph edge schema
export const GraphEdgeSchema = z.object({
  id: z.string(),
  analysisId: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  type: EdgeTypeSchema,
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

// Full graph with nodes and edges
export interface CodeGraph {
  analysisId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    nodesByType: Record<NodeType, number>;
    edgesByType: Record<EdgeType, number>;
  };
}

// Impact analysis result
export interface ImpactAnalysisResult {
  targetFile: string;
  targetFunction?: string;
  directDependents: string[];
  transitiveDependents: string[];
  affectedFiles: string[];
  impactScore: number; // 0-100 based on how many things depend on it
  vulnerabilityPropagation: Array<{
    finding: string;
    propagationPath: string[];
  }>;
}

// AST extraction result
export interface AstExtractionResult {
  file: string;
  language: string;
  nodes: Omit<GraphNode, 'id' | 'analysisId' | 'createdAt'>[];
  edges: Omit<GraphEdge, 'id' | 'analysisId' | 'createdAt'>[];
  errors: string[];
}
