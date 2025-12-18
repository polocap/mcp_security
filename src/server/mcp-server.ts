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

// Import tool handlers (to be implemented)
// import { handleAnalyzeProject } from './tools/analyze-project.js';
// import { handleGetReport } from './tools/get-report.js';

const SERVER_NAME = 'mcp-code-analyzer';
const SERVER_VERSION = '0.1.0';

export class McpAnalyzerServer {
  private server: Server;
  private config;

  constructor() {
    this.config = loadConfig();
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
            // TODO: Implement actual analysis
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    status: 'not_implemented',
                    message: 'Analysis functionality coming soon',
                    request: validatedArgs,
                  }, null, 2),
                },
              ],
            };
          }

          case 'get_analysis_report':
          case 'compare_analyses':
          case 'list_project_analyses':
          case 'get_findings':
          case 'get_code_graph':
          case 'analyze_impact':
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    status: 'not_implemented',
                    message: `Tool ${name} coming soon`,
                    args,
                  }, null, 2),
                },
              ],
            };

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
