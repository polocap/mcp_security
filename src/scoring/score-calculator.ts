import type { ScoringConfig } from '../types/config.js';
import type { NormalizedFinding, ScannerResult, Category, Severity } from '../types/findings.js';
import type { AggregateScore, CategoryScores, Grade, Trend } from '../types/scores.js';
import { calculateGrade, calculateTrend } from '../types/scores.js';

export class ScoreCalculator {
  private config: ScoringConfig;

  constructor(config: ScoringConfig) {
    this.config = config;
  }

  /**
   * Calculate score for a single category based on findings
   */
  calculateCategoryScore(
    findings: NormalizedFinding[],
    category: Category
  ): number {
    const penalties = this.config.penalties[category];
    let score = 100;

    for (const finding of findings) {
      if (finding.category === category) {
        const penalty = penalties[finding.severity as Severity] || 0;
        score -= penalty;
      }
    }

    // Apply diminishing returns for many findings
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Calculate scores for all categories
   */
  calculateCategoryScores(findings: NormalizedFinding[]): CategoryScores {
    return {
      security: this.calculateCategoryScore(findings, 'security'),
      quality: this.calculateCategoryScore(findings, 'quality'),
      dependencies: this.calculateCategoryScore(findings, 'dependencies'),
      architecture: this.calculateCategoryScore(findings, 'architecture'),
    };
  }

  /**
   * Calculate overall weighted score
   */
  calculateOverallScore(categoryScores: CategoryScores): number {
    const weights = this.config.weights;

    const weightedSum =
      categoryScores.security * weights.security +
      categoryScores.quality * weights.quality +
      categoryScores.dependencies * weights.dependencies +
      categoryScores.architecture * weights.architecture;

    return Math.round(weightedSum);
  }

  /**
   * Calculate aggregate score from findings and scanner results
   */
  calculateAggregateScore(
    findings: NormalizedFinding[],
    scannerResults?: ScannerResult[]
  ): AggregateScore {
    // Use scanner-provided scores if available, otherwise calculate from findings
    const categoryScores = this.calculateCategoryScores(findings);

    // If scanner results are provided, use their raw scores for categories that ran
    if (scannerResults) {
      for (const result of scannerResults) {
        if (result.status === 'success' && result.rawScore !== undefined) {
          const category = result.category as keyof CategoryScores;
          if (category in categoryScores) {
            // Average the calculated score with the scanner's raw score
            categoryScores[category] = Math.round(
              (categoryScores[category] + result.rawScore) / 2
            );
          }
        }
      }
    }

    const overall = this.calculateOverallScore(categoryScores);
    const grade = calculateGrade(overall);

    return {
      overall,
      security: categoryScores.security,
      quality: categoryScores.quality,
      dependencies: categoryScores.dependencies,
      architecture: categoryScores.architecture,
      grade,
      trend: null,
    };
  }

  /**
   * Calculate trend compared to previous score
   */
  calculateTrend(currentScore: number, previousScore: number | null): Trend | null {
    return calculateTrend(currentScore, previousScore);
  }

  /**
   * Calculate comparison between two analyses
   */
  calculateComparison(
    currentFindings: NormalizedFinding[],
    previousFindings: NormalizedFinding[],
    currentScore: AggregateScore,
    previousScore: AggregateScore
  ): {
    overallDelta: number;
    categoryDeltas: Record<Category, number>;
    newIssues: number;
    fixedIssues: number;
    newFindings: NormalizedFinding[];
    fixedFindings: NormalizedFinding[];
  } {
    // Calculate deltas
    const overallDelta = currentScore.overall - previousScore.overall;
    const categoryDeltas: Record<Category, number> = {
      security: currentScore.security - previousScore.security,
      quality: currentScore.quality - previousScore.quality,
      dependencies: currentScore.dependencies - previousScore.dependencies,
      architecture: currentScore.architecture - previousScore.architecture,
    };

    // Find new and fixed issues by comparing finding signatures
    const previousSignatures = new Set(
      previousFindings.map((f) => this.getFindingSignature(f))
    );
    const currentSignatures = new Set(
      currentFindings.map((f) => this.getFindingSignature(f))
    );

    const newFindings = currentFindings.filter(
      (f) => !previousSignatures.has(this.getFindingSignature(f))
    );
    const fixedFindings = previousFindings.filter(
      (f) => !currentSignatures.has(this.getFindingSignature(f))
    );

    return {
      overallDelta,
      categoryDeltas,
      newIssues: newFindings.length,
      fixedIssues: fixedFindings.length,
      newFindings,
      fixedFindings,
    };
  }

  /**
   * Create a signature for a finding to detect duplicates across analyses
   */
  private getFindingSignature(finding: NormalizedFinding): string {
    // Signature based on scanner, rule, and location
    return [
      finding.scanner,
      finding.ruleId || finding.title,
      finding.file || '',
      finding.line?.toString() || '',
    ].join('::');
  }

  /**
   * Update scoring weights
   */
  updateWeights(weights: Partial<ScoringConfig['weights']>): void {
    this.config.weights = { ...this.config.weights, ...weights };

    // Normalize weights to sum to 1
    const total = Object.values(this.config.weights).reduce((a, b) => a + b, 0);
    if (total > 0) {
      for (const key of Object.keys(this.config.weights) as (keyof typeof this.config.weights)[]) {
        this.config.weights[key] /= total;
      }
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ScoringConfig {
    return { ...this.config };
  }
}
