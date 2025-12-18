import { z } from 'zod';

// Grade schema
export const GradeSchema = z.enum(['A', 'B', 'C', 'D', 'F']);
export type Grade = z.infer<typeof GradeSchema>;

// Trend schema
export const TrendSchema = z.enum(['improving', 'stable', 'declining']);
export type Trend = z.infer<typeof TrendSchema>;

// Category scores schema
export const CategoryScoresSchema = z.object({
  security: z.number().min(0).max(100),
  quality: z.number().min(0).max(100),
  dependencies: z.number().min(0).max(100),
  architecture: z.number().min(0).max(100),
});

export type CategoryScores = z.infer<typeof CategoryScoresSchema>;

// Aggregate score schema
export const AggregateScoreSchema = z.object({
  overall: z.number().min(0).max(100),
  security: z.number().min(0).max(100),
  quality: z.number().min(0).max(100),
  dependencies: z.number().min(0).max(100),
  architecture: z.number().min(0).max(100),
  grade: GradeSchema,
  trend: TrendSchema.nullable(),
});

export type AggregateScore = z.infer<typeof AggregateScoreSchema>;

// Score comparison
export interface ScoreComparison {
  previousScore: AggregateScore;
  currentScore: AggregateScore;
  overallDelta: number;
  categoryDeltas: {
    security: number;
    quality: number;
    dependencies: number;
    architecture: number;
  };
  newIssues: number;
  fixedIssues: number;
}

// Helper function to calculate grade
export function calculateGrade(score: number): Grade {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

// Helper function to determine trend
export function calculateTrend(current: number, previous: number | null): Trend | null {
  if (previous === null) return null;
  const delta = current - previous;
  if (delta > 5) return 'improving';
  if (delta < -5) return 'declining';
  return 'stable';
}
