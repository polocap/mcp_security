import { z } from 'zod';

// Retry configuration schema
export const RetryConfigSchema = z.object({
  maxAttempts: z.number().min(1).max(10).default(3),
  delayMs: z.number().min(100).max(60000).default(2000),
  backoffMultiplier: z.number().min(1).max(5).default(2),
});

export type RetryConfig = z.infer<typeof RetryConfigSchema>;

// MCP Server configuration schema
export const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
  layer: z.number().min(1).max(5),
  category: z.enum(['repos', 'security', 'quality', 'dependencies', 'architecture']).optional(),
  description: z.string().optional(),
  retry: RetryConfigSchema.optional(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

// Scoring penalties schema
export const SeverityPenaltiesSchema = z.object({
  critical: z.number(),
  high: z.number(),
  medium: z.number(),
  low: z.number(),
  info: z.number(),
});

export type SeverityPenalties = z.infer<typeof SeverityPenaltiesSchema>;

// Scoring configuration schema
export const ScoringConfigSchema = z.object({
  weights: z.object({
    security: z.number(),
    quality: z.number(),
    dependencies: z.number(),
    architecture: z.number(),
  }),
  penalties: z.object({
    security: SeverityPenaltiesSchema,
    quality: SeverityPenaltiesSchema,
    dependencies: SeverityPenaltiesSchema,
    architecture: SeverityPenaltiesSchema,
  }),
});

export type ScoringConfig = z.infer<typeof ScoringConfigSchema>;

// Full configuration schema
export const ConfigSchema = z.object({
  servers: z.record(McpServerConfigSchema),
  defaults: z.object({
    retry: RetryConfigSchema,
    timeout: z.number().default(300000),
  }),
  scoring: ScoringConfigSchema,
});

export type Config = z.infer<typeof ConfigSchema>;

// Analysis request schema
export const AnalysisRequestSchema = z.object({
  source: z.string().min(1),
  scanners: z.array(z.enum(['security', 'quality', 'dependencies', 'architecture'])).optional(),
  languages: z.array(z.string()).optional(),
  branch: z.string().optional(),
});

export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;
