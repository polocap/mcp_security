import { z } from 'zod';

// Severity levels
export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;

// Finding categories
export const CategorySchema = z.enum(['security', 'quality', 'dependencies', 'architecture']);
export type Category = z.infer<typeof CategorySchema>;

// Normalized finding schema - common format for all scanners
export const NormalizedFindingSchema = z.object({
  id: z.string(),
  scanner: z.string(),
  category: CategorySchema,
  severity: SeveritySchema,
  title: z.string(),
  description: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
  codeSnippet: z.string().optional(),
  remediation: z.string().optional(),
  cwe: z.string().optional(),
  cve: z.string().optional(),
  ruleId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
});

export type NormalizedFinding = z.infer<typeof NormalizedFindingSchema>;

// Scanner result schema
export const ScannerResultSchema = z.object({
  scanner: z.string(),
  category: CategorySchema,
  status: z.enum(['success', 'failed', 'timeout', 'skipped']),
  findings: z.array(NormalizedFindingSchema),
  durationMs: z.number(),
  error: z.string().optional(),
  rawScore: z.number().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ScannerResult = z.infer<typeof ScannerResultSchema>;

// Findings summary
export interface FindingsSummary {
  total: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<Category, number>;
  byScanner: Record<string, number>;
}
