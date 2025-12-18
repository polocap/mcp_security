import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Config, ConfigSchema } from '../types/config.js';
import { logger } from './logger.js';

const DEFAULT_CONFIG_FILENAME = 'mcp-servers.config.json';
const USER_CONFIG_DIR = '.mcp-analyzer';

/**
 * Default configuration used when no config files are found
 */
const DEFAULT_CONFIG: Partial<Config> = {
  servers: {},
  defaults: {
    retry: {
      maxAttempts: 3,
      delayMs: 2000,
      backoffMultiplier: 2,
    },
    timeout: 300000,
  },
  scoring: {
    weights: {
      security: 0.35,
      quality: 0.25,
      dependencies: 0.25,
      architecture: 0.15,
    },
    penalties: {
      security: { critical: 25, high: 15, medium: 8, low: 3, info: 0 },
      quality: { critical: 20, high: 12, medium: 6, low: 2, info: 0 },
      dependencies: { critical: 25, high: 15, medium: 8, low: 3, info: 0 },
      architecture: { critical: 15, high: 10, medium: 5, low: 2, info: 0 },
    },
  },
};

/**
 * Load configuration from multiple sources with priority:
 * 1. CLI flags (highest priority) - handled externally
 * 2. Project config (.mcp-analyzer.json in project root)
 * 3. User config (~/.mcp-analyzer/config.json)
 * 4. Default config (mcp-servers.config.json in package)
 */
export function loadConfig(projectPath?: string): Config {
  const configs: Partial<Config>[] = [];

  // Load default config
  const defaultConfigPath = join(process.cwd(), DEFAULT_CONFIG_FILENAME);
  if (existsSync(defaultConfigPath)) {
    try {
      const content = readFileSync(defaultConfigPath, 'utf-8');
      configs.push(JSON.parse(content) as Partial<Config>);
      logger.debug(`Loaded default config from ${defaultConfigPath}`);
    } catch (error) {
      logger.warn(`Failed to load default config: ${error}`);
    }
  }

  // Load user config
  const userConfigPath = join(homedir(), USER_CONFIG_DIR, 'config.json');
  if (existsSync(userConfigPath)) {
    try {
      const content = readFileSync(userConfigPath, 'utf-8');
      configs.push(JSON.parse(content) as Partial<Config>);
      logger.debug(`Loaded user config from ${userConfigPath}`);
    } catch (error) {
      logger.warn(`Failed to load user config: ${error}`);
    }
  }

  // Load project config
  if (projectPath) {
    const projectConfigPath = join(projectPath, '.mcp-analyzer.json');
    if (existsSync(projectConfigPath)) {
      try {
        const content = readFileSync(projectConfigPath, 'utf-8');
        configs.push(JSON.parse(content) as Partial<Config>);
        logger.debug(`Loaded project config from ${projectConfigPath}`);
      } catch (error) {
        logger.warn(`Failed to load project config: ${error}`);
      }
    }
  }

  // Merge configs (later configs override earlier ones)
  const mergedConfig = mergeConfigs(configs);

  // Validate and return
  const result = ConfigSchema.safeParse(mergedConfig);
  if (!result.success) {
    logger.error('Invalid configuration:', result.error.format());
    throw new Error('Invalid configuration');
  }

  // Expand environment variables in config
  return expandEnvVars(result.data);
}

/**
 * Deep merge multiple config objects
 */
function mergeConfigs(configs: Partial<Config>[]): Partial<Config> {
  // Start with default config, then merge any found configs on top
  const baseConfig = { ...DEFAULT_CONFIG };

  if (configs.length === 0) {
    logger.debug('No configuration files found, using defaults');
    return baseConfig;
  }

  return configs.reduce((acc, config) => {
    return deepMerge(acc, config);
  }, baseConfig as Partial<Config>);
}

/**
 * Deep merge two objects
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (isObject(sourceValue) && isObject(targetValue)) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Expand environment variables in config values
 */
function expandEnvVars(config: Config): Config {
  const expanded = JSON.stringify(config);
  const result = expanded.replace(/\$\{(\w+)\}/g, (_, envVar: string) => {
    return process.env[envVar] || '';
  });
  return JSON.parse(result) as Config;
}

/**
 * Get enabled servers from config
 */
export function getEnabledServers(config: Config): string[] {
  return Object.entries(config.servers)
    .filter(([_, serverConfig]) => serverConfig.enabled)
    .map(([name]) => name);
}

/**
 * Get servers by layer
 */
export function getServersByLayer(config: Config, layer: number): string[] {
  return Object.entries(config.servers)
    .filter(([_, serverConfig]) => serverConfig.enabled && serverConfig.layer === layer)
    .map(([name]) => name);
}

/**
 * Get servers by category
 */
export function getServersByCategory(config: Config, category: string): string[] {
  return Object.entries(config.servers)
    .filter(([_, serverConfig]) => serverConfig.enabled && serverConfig.category === category)
    .map(([name]) => name);
}
