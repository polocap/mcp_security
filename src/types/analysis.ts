import { z } from 'zod';
import { AggregateScoreSchema } from './scores.js';
import { NormalizedFindingSchema, FindingsSummary } from './findings.js';

// Analysis status
export const AnalysisStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

// Project schema
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  path: z.string(),
  name: z.string(),
  detectedLanguages: z.array(z.string()),
  firstAnalyzedAt: z.string().datetime(),
  lastAnalyzedAt: z.string().datetime(),
  analysisCount: z.number().default(0),
  createdAt: z.string().datetime(),
});

export type Project = z.infer<typeof ProjectSchema>;

// Analysis schema
export const AnalysisSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  status: AnalysisStatusSchema,
  durationMs: z.number().nullable(),
  gitCommit: z.string().nullable(),
  gitBranch: z.string().nullable(),
  scores: AggregateScoreSchema.nullable(),
  scannersRun: z.array(z.string()),
  scannersFailed: z.array(z.string()),
  config: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type Analysis = z.infer<typeof AnalysisSchema>;

// Analysis result (full details)
export interface AnalysisResult {
  analysis: Analysis;
  project: Project;
  findings: z.infer<typeof NormalizedFindingSchema>[];
  summary: FindingsSummary;
}

// Analysis history entry
export interface AnalysisHistoryEntry {
  id: string;
  startedAt: string;
  status: AnalysisStatus;
  scores: z.infer<typeof AggregateScoreSchema> | null;
  findingsCount: number;
}

// Project with history
export interface ProjectWithHistory {
  project: Project;
  analyses: AnalysisHistoryEntry[];
  trend: {
    overallScores: number[];
    dates: string[];
  };
}
