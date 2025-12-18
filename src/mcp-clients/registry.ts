import { BaseMcpClient } from './base-client.js';
import { logger } from '../utils/logger.js';
import type { Config, McpServerConfig } from '../types/config.js';

// Import specific client implementations
// import { SemgrepClient } from './semgrep-client.js';
// import { TrivyClient } from './trivy-client.js';
// import { EslintClient } from './eslint-client.js';

export class McpClientRegistry {
  private clients: Map<string, BaseMcpClient> = new Map();
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Get or create a client for a server
   */
  getClient(serverName: string): BaseMcpClient | null {
    // Return existing client if available
    if (this.clients.has(serverName)) {
      return this.clients.get(serverName)!;
    }

    // Get server config
    const serverConfig = this.config.servers[serverName];
    if (!serverConfig) {
      logger.warn(`No configuration found for server: ${serverName}`);
      return null;
    }

    if (!serverConfig.enabled) {
      logger.debug(`Server ${serverName} is disabled`);
      return null;
    }

    // Create client based on server name
    const client = this.createClient(serverName, serverConfig);
    if (client) {
      this.clients.set(serverName, client);
    }

    return client;
  }

  /**
   * Create a client instance for a server
   */
  private createClient(serverName: string, config: McpServerConfig): BaseMcpClient | null {
    // TODO: Implement specific client classes for each MCP server
    // For now, return null as we haven't implemented the specific clients yet
    logger.debug(`Client creation for ${serverName} not yet implemented`);
    return null;

    // Example of how this will work:
    // switch (serverName) {
    //   case 'semgrep':
    //     return new SemgrepClient({ name: serverName, config, retryConfig: config.retry });
    //   case 'trivy':
    //     return new TrivyClient({ name: serverName, config, retryConfig: config.retry });
    //   case 'eslint':
    //     return new EslintClient({ name: serverName, config, retryConfig: config.retry });
    //   default:
    //     logger.warn(`Unknown server type: ${serverName}`);
    //     return null;
    // }
  }

  /**
   * Get all enabled clients by layer
   */
  getClientsByLayer(layer: number): BaseMcpClient[] {
    const clients: BaseMcpClient[] = [];

    for (const [name, serverConfig] of Object.entries(this.config.servers)) {
      if (serverConfig.enabled && serverConfig.layer === layer) {
        const client = this.getClient(name);
        if (client) {
          clients.push(client);
        }
      }
    }

    return clients;
  }

  /**
   * Get all enabled clients by category
   */
  getClientsByCategory(category: string): BaseMcpClient[] {
    const clients: BaseMcpClient[] = [];

    for (const [name, serverConfig] of Object.entries(this.config.servers)) {
      if (serverConfig.enabled && serverConfig.category === category) {
        const client = this.getClient(name);
        if (client) {
          clients.push(client);
        }
      }
    }

    return clients;
  }

  /**
   * Get all enabled server names
   */
  getEnabledServerNames(): string[] {
    return Object.entries(this.config.servers)
      .filter(([_, config]) => config.enabled)
      .map(([name]) => name);
  }

  /**
   * Connect all clients
   */
  async connectAll(): Promise<void> {
    const serverNames = this.getEnabledServerNames();

    for (const name of serverNames) {
      const client = this.getClient(name);
      if (client) {
        try {
          await client.connect();
        } catch (error) {
          logger.error(`Failed to connect to ${name}: ${error}`);
        }
      }
    }
  }

  /**
   * Disconnect all clients
   */
  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients) {
      try {
        await client.disconnect();
        logger.debug(`Disconnected from ${name}`);
      } catch (error) {
        logger.error(`Error disconnecting from ${name}: ${error}`);
      }
    }
    this.clients.clear();
  }

  /**
   * Health check for all servers
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const serverNames = this.getEnabledServerNames();

    for (const name of serverNames) {
      try {
        const client = this.getClient(name);
        if (client) {
          await client.connect();
          results.set(name, true);
          await client.disconnect();
        } else {
          results.set(name, false);
        }
      } catch {
        results.set(name, false);
      }
    }

    return results;
  }
}
