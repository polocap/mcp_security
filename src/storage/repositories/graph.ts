import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database.js';
import { logger } from '../../utils/logger.js';
import type { GraphNode, GraphEdge, NodeType, EdgeType, CodeGraph } from '../../types/graph.js';

const graphLogger = logger.child('graph-repo');

export interface CreateNodeInput {
  analysisId: string;
  type: NodeType;
  name: string;
  file?: string;
  lineStart?: number;
  lineEnd?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateEdgeInput {
  analysisId: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  metadata?: Record<string, unknown>;
}

export class GraphRepository {
  private db = getDatabase();

  // Node operations
  createNode(input: CreateNodeInput): GraphNode {
    const now = new Date().toISOString();
    const id = uuidv4();

    graphLogger.debug(`Creating node: ${input.type} "${input.name}" in ${input.file || 'unknown'}`);

    const stmt = this.db.prepare(`
      INSERT INTO graph_nodes (id, analysis_id, type, name, file, line_start, line_end, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.analysisId,
      input.type,
      input.name,
      input.file || null,
      input.lineStart || null,
      input.lineEnd || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now
    );

    return this.findNodeById(id)!;
  }

  createNodes(inputs: CreateNodeInput[]): GraphNode[] {
    const now = new Date().toISOString();

    graphLogger.info(`Creating ${inputs.length} nodes in batch`);

    const stmt = this.db.prepare(`
      INSERT INTO graph_nodes (id, analysis_id, type, name, file, line_start, line_end, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const ids: string[] = [];
    const insertMany = this.db.transaction((inputs: CreateNodeInput[]) => {
      for (const input of inputs) {
        const id = uuidv4();
        ids.push(id);
        stmt.run(
          id,
          input.analysisId,
          input.type,
          input.name,
          input.file || null,
          input.lineStart || null,
          input.lineEnd || null,
          input.metadata ? JSON.stringify(input.metadata) : null,
          now
        );
      }
    });

    insertMany(inputs);
    graphLogger.debug(`Created ${ids.length} nodes`);
    return ids.map((id) => this.findNodeById(id)!);
  }

  findNodeById(id: string): GraphNode | null {
    const stmt = this.db.prepare('SELECT * FROM graph_nodes WHERE id = ?');
    const row = stmt.get(id) as NodeRow | undefined;
    return row ? this.mapRowToNode(row) : null;
  }

  findNodesByAnalysisId(analysisId: string, options?: { type?: NodeType; file?: string }): GraphNode[] {
    let query = 'SELECT * FROM graph_nodes WHERE analysis_id = ?';
    const params: unknown[] = [analysisId];

    if (options?.type) {
      query += ' AND type = ?';
      params.push(options.type);
    }
    if (options?.file) {
      query += ' AND file = ?';
      params.push(options.file);
    }

    query += ' ORDER BY file, line_start';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as NodeRow[];
    graphLogger.debug(`Found ${rows.length} nodes for analysis ${analysisId}`);
    return rows.map(this.mapRowToNode);
  }

  findNodeByName(analysisId: string, name: string, type?: NodeType): GraphNode | null {
    let query = 'SELECT * FROM graph_nodes WHERE analysis_id = ? AND name = ?';
    const params: unknown[] = [analysisId, name];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    const stmt = this.db.prepare(query);
    const row = stmt.get(...params) as NodeRow | undefined;
    return row ? this.mapRowToNode(row) : null;
  }

  // Edge operations
  createEdge(input: CreateEdgeInput): GraphEdge {
    const now = new Date().toISOString();
    const id = uuidv4();

    graphLogger.debug(`Creating edge: ${input.type} from ${input.sourceId} to ${input.targetId}`);

    const stmt = this.db.prepare(`
      INSERT INTO graph_edges (id, analysis_id, source_id, target_id, type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.analysisId,
      input.sourceId,
      input.targetId,
      input.type,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now
    );

    return this.findEdgeById(id)!;
  }

  createEdges(inputs: CreateEdgeInput[]): GraphEdge[] {
    const now = new Date().toISOString();

    graphLogger.info(`Creating ${inputs.length} edges in batch`);

    const stmt = this.db.prepare(`
      INSERT INTO graph_edges (id, analysis_id, source_id, target_id, type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const ids: string[] = [];
    const insertMany = this.db.transaction((inputs: CreateEdgeInput[]) => {
      for (const input of inputs) {
        const id = uuidv4();
        ids.push(id);
        stmt.run(
          id,
          input.analysisId,
          input.sourceId,
          input.targetId,
          input.type,
          input.metadata ? JSON.stringify(input.metadata) : null,
          now
        );
      }
    });

    insertMany(inputs);
    graphLogger.debug(`Created ${ids.length} edges`);
    return ids.map((id) => this.findEdgeById(id)!);
  }

  findEdgeById(id: string): GraphEdge | null {
    const stmt = this.db.prepare('SELECT * FROM graph_edges WHERE id = ?');
    const row = stmt.get(id) as EdgeRow | undefined;
    return row ? this.mapRowToEdge(row) : null;
  }

  findEdgesByAnalysisId(analysisId: string, options?: { type?: EdgeType }): GraphEdge[] {
    let query = 'SELECT * FROM graph_edges WHERE analysis_id = ?';
    const params: unknown[] = [analysisId];

    if (options?.type) {
      query += ' AND type = ?';
      params.push(options.type);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as EdgeRow[];
    graphLogger.debug(`Found ${rows.length} edges for analysis ${analysisId}`);
    return rows.map(this.mapRowToEdge);
  }

  // Find edges where this node is the source (what this node calls/uses)
  findOutgoingEdges(nodeId: string): GraphEdge[] {
    const stmt = this.db.prepare('SELECT * FROM graph_edges WHERE source_id = ?');
    const rows = stmt.all(nodeId) as EdgeRow[];
    return rows.map(this.mapRowToEdge);
  }

  // Find edges where this node is the target (what calls/uses this node)
  findIncomingEdges(nodeId: string): GraphEdge[] {
    const stmt = this.db.prepare('SELECT * FROM graph_edges WHERE target_id = ?');
    const rows = stmt.all(nodeId) as EdgeRow[];
    return rows.map(this.mapRowToEdge);
  }

  // Get full graph for an analysis
  getFullGraph(analysisId: string): CodeGraph {
    graphLogger.info(`Loading full graph for analysis ${analysisId}`);

    const nodes = this.findNodesByAnalysisId(analysisId);
    const edges = this.findEdgesByAnalysisId(analysisId);

    // Calculate stats
    const nodesByType: Record<NodeType, number> = {
      module: 0,
      class: 0,
      function: 0,
      variable: 0,
      import: 0,
      export: 0,
    };
    for (const node of nodes) {
      nodesByType[node.type]++;
    }

    const edgesByType: Record<EdgeType, number> = {
      imports: 0,
      calls: 0,
      inherits: 0,
      implements: 0,
      uses: 0,
      defines: 0,
      contains: 0,
      depends_on: 0,
    };
    for (const edge of edges) {
      edgesByType[edge.type]++;
    }

    graphLogger.info(`Graph loaded: ${nodes.length} nodes, ${edges.length} edges`);

    return {
      analysisId,
      nodes,
      edges,
      stats: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        nodesByType,
        edgesByType,
      },
    };
  }

  // Delete all graph data for an analysis
  deleteByAnalysisId(analysisId: string): void {
    graphLogger.info(`Deleting graph data for analysis ${analysisId}`);

    const deleteEdges = this.db.prepare('DELETE FROM graph_edges WHERE analysis_id = ?');
    const deleteNodes = this.db.prepare('DELETE FROM graph_nodes WHERE analysis_id = ?');

    const transaction = this.db.transaction(() => {
      deleteEdges.run(analysisId);
      deleteNodes.run(analysisId);
    });

    transaction();
    graphLogger.debug('Graph data deleted');
  }

  private mapRowToNode(row: NodeRow): GraphNode {
    return {
      id: row.id,
      analysisId: row.analysis_id,
      type: row.type as NodeType,
      name: row.name,
      file: row.file || undefined,
      lineStart: row.line_start || undefined,
      lineEnd: row.line_end || undefined,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
      createdAt: row.created_at,
    };
  }

  private mapRowToEdge(row: EdgeRow): GraphEdge {
    return {
      id: row.id,
      analysisId: row.analysis_id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type as EdgeType,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
      createdAt: row.created_at,
    };
  }
}

interface NodeRow {
  id: string;
  analysis_id: string;
  type: string;
  name: string;
  file: string | null;
  line_start: number | null;
  line_end: number | null;
  metadata: string | null;
  created_at: string;
}

interface EdgeRow {
  id: string;
  analysis_id: string;
  source_id: string;
  target_id: string;
  type: string;
  metadata: string | null;
  created_at: string;
}

export const graphRepository = new GraphRepository();
