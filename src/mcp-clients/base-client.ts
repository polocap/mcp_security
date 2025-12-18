import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../utils/logger.js';
import type { McpServerConfig, RetryConfig } from '../types/config.js';
import type { ScannerResult, NormalizedFinding, Category } from '../types/findings.js';

export interface McpClientOptions {
  name: string;
  config: McpServerConfig;
  retryConfig?: RetryConfig;
}

export interface ScanOptions {
  projectPath: string;
  files?: string[];
  languages?: string[];
}

export abstract class BaseMcpClient {
  protected name: string;
  protected config: McpServerConfig;
  protected retryConfig: RetryConfig;
  protected client: Client | null = null;
  protected transport: StdioClientTransport | null = null;
  protected connected = false;

  constructor(options: McpClientOptions) {
    this.name = options.name;
    this.config = options.config;
    this.retryConfig = options.retryConfig || {
      maxAttempts: 3,
      delayMs: 2000,
      backoffMultiplier: 2,
    };
  }

  /**
   * Connect to the MCP server
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    const clientLogger = logger.child(this.name);
    clientLogger.info(`Connecting to ${this.name} MCP server...`);

    try {
      // Build environment
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
      if (this.config.env) {
        Object.assign(env, this.config.env);
      }

      // Create transport (spawns the process internally)
      this.transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args,
        env,
      });

      this.client = new Client(
        { name: `mcp-analyzer-${this.name}`, version: '0.1.0' },
        { capabilities: {} }
      );

      await this.client.connect(this.transport);
      this.connected = true;
      clientLogger.success(`Connected to ${this.name}`);
    } catch (error) {
      clientLogger.error(`Failed to connect: ${error}`);
      await this.disconnect();
      throw error;
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch {
        // Ignore errors on close
      }
      this.client = null;
    }

    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Ignore errors on close
      }
      this.transport = null;
    }

    this.connected = false;
    logger.child(this.name).debug('Disconnected');
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get available tools from the MCP server
   */
  async listTools(): Promise<string[]> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    const result = await this.client.listTools();
    return result.tools.map((t) => t.name);
  }

  /**
   * Call a tool on the MCP server
   */
  protected async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    const result = await this.client.callTool({ name: toolName, arguments: args });

    // Extract text content from result
    if (result.content && Array.isArray(result.content)) {
      const textContent = result.content.find((c) => c.type === 'text');
      if (textContent && 'text' in textContent) {
        try {
          return JSON.parse(textContent.text as string);
        } catch {
          return textContent.text;
        }
      }
    }

    return result;
  }

  /**
   * Execute a scan with retry logic
   */
  async scan(options: ScanOptions): Promise<ScannerResult> {
    const startTime = Date.now();
    const clientLogger = logger.child(this.name);

    let lastError: Error | null = null;
    let delay = this.retryConfig.delayMs;

    for (let attempt = 1; attempt <= this.retryConfig.maxAttempts; attempt++) {
      try {
        clientLogger.info(`Scan attempt ${attempt}/${this.retryConfig.maxAttempts}`);

        if (!this.connected) {
          await this.connect();
        }

        const findings = await this.executeScan(options);
        const durationMs = Date.now() - startTime;

        clientLogger.success(`Scan completed: ${findings.length} findings in ${durationMs}ms`);

        return {
          scanner: this.name,
          category: this.getCategory(),
          status: 'success',
          findings,
          durationMs,
          rawScore: this.calculateScore(findings),
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        clientLogger.warn(`Attempt ${attempt} failed: ${lastError.message}`);

        if (attempt < this.retryConfig.maxAttempts) {
          clientLogger.info(`Retrying in ${delay}ms...`);
          await this.sleep(delay);
          delay *= this.retryConfig.backoffMultiplier;

          // Try reconnecting
          await this.disconnect();
        }
      }
    }

    const durationMs = Date.now() - startTime;
    clientLogger.error(`All ${this.retryConfig.maxAttempts} attempts failed`);

    return {
      scanner: this.name,
      category: this.getCategory(),
      status: 'failed',
      findings: [],
      durationMs,
      error: lastError?.message || 'Unknown error',
    };
  }

  /**
   * Abstract method to be implemented by specific scanner clients
   */
  protected abstract executeScan(options: ScanOptions): Promise<NormalizedFinding[]>;

  /**
   * Get the category of this scanner
   */
  protected abstract getCategory(): Category;

  /**
   * Calculate a raw score based on findings
   */
  protected calculateScore(findings: NormalizedFinding[]): number {
    const penalties: Record<string, number> = {
      critical: 25,
      high: 15,
      medium: 8,
      low: 3,
      info: 0,
    };

    let score = 100;
    for (const finding of findings) {
      score -= penalties[finding.severity] || 0;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Sleep utility
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
