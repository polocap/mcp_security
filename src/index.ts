#!/usr/bin/env node

import { startMcpServer } from './server/mcp-server.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'mcp':
      case undefined:
        // Default: start MCP server
        await startMcpServer();
        break;

      case 'serve':
        // Start REST API server
        logger.info('REST API server not yet implemented');
        process.exit(1);
        break;

      default:
        // CLI commands are handled by cli/index.ts
        logger.error(`Unknown command: ${command}`);
        logger.info('Usage: mcp-analyze [mcp|serve]');
        process.exit(1);
    }
  } catch (error) {
    logger.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
