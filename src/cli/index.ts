#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { logger } from '../utils/logger.js';
import { Orchestrator } from '../orchestrator/index.js';
import { loadConfig } from '../utils/config.js';
import { analysesRepository } from '../storage/repositories/analyses.js';
import { findingsRepository } from '../storage/repositories/findings.js';
import { projectsRepository } from '../storage/repositories/projects.js';
import { McpClientRegistry } from '../mcp-clients/registry.js';
import { getDatabase } from '../storage/database.js';
import type { Category } from '../types/findings.js';

const program = new Command();

// Initialize database on startup
getDatabase();

program
  .name('mcp-analyze')
  .description('MCP orchestrator for code security, quality, and architecture analysis')
  .version('0.1.0');

program
  .command('analyze <source>')
  .description('Analyze a project for security, quality, and dependency issues')
  .option('-s, --scanners <scanners>', 'Comma-separated list of scanners to run (security,quality,dependencies,architecture)')
  .option('-l, --languages <languages>', 'Comma-separated list of languages to analyze')
  .option('-f, --format <format>', 'Output format (json, md, console)', 'console')
  .option('-o, --output <file>', 'Output file path')
  .option('-b, --branch <branch>', 'Git branch to analyze')
  .option('-v, --verbose', 'Verbose output')
  .action(async (source: string, options) => {
    if (options.verbose) {
      logger.setLevel('debug');
    }

    console.log(chalk.blue('\n📊 MCP Code Analyzer\n'));
    console.log(chalk.gray(`Analyzing: ${source}`));

    try {
      const config = loadConfig();
      const orchestrator = new Orchestrator({ config });

      const scanners = options.scanners
        ? (options.scanners.split(',') as Category[])
        : undefined;
      const languages = options.languages
        ? options.languages.split(',')
        : undefined;

      console.log(chalk.gray('Starting analysis...\n'));

      const result = await orchestrator.analyze({
        source,
        scanners,
        languages,
        branch: options.branch,
      });

      // Format output
      if (options.format === 'json') {
        const output = JSON.stringify(result, null, 2);
        if (options.output) {
          writeFileSync(options.output, output);
          console.log(chalk.green(`✓ Report saved to ${options.output}`));
        } else {
          console.log(output);
        }
      } else if (options.format === 'md') {
        const output = formatMarkdownReport(result);
        if (options.output) {
          writeFileSync(options.output, output);
          console.log(chalk.green(`✓ Report saved to ${options.output}`));
        } else {
          console.log(output);
        }
      } else {
        // Console format
        printConsoleReport(result);
      }

      await orchestrator.shutdown();
    } catch (error) {
      console.error(chalk.red(`\n✗ Analysis failed: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('report <analysis-id>')
  .description('Generate a report for a completed analysis')
  .option('-f, --format <format>', 'Report format (json, md, console)', 'console')
  .option('-o, --output <file>', 'Output file path')
  .action(async (analysisId: string, options) => {
    try {
      const analysis = analysesRepository.findById(analysisId);
      if (!analysis) {
        console.error(chalk.red(`✗ Analysis not found: ${analysisId}`));
        process.exit(1);
      }

      const project = projectsRepository.findById(analysis.projectId);
      const findings = findingsRepository.findByAnalysisId(analysisId);
      const summary = findingsRepository.getSummaryByAnalysisId(analysisId);

      const result = { analysis, project, findings, summary };

      if (options.format === 'json') {
        const output = JSON.stringify(result, null, 2);
        if (options.output) {
          writeFileSync(options.output, output);
          console.log(chalk.green(`✓ Report saved to ${options.output}`));
        } else {
          console.log(output);
        }
      } else if (options.format === 'md') {
        const output = formatMarkdownReport(result);
        if (options.output) {
          writeFileSync(options.output, output);
          console.log(chalk.green(`✓ Report saved to ${options.output}`));
        } else {
          console.log(output);
        }
      } else {
        printConsoleReport(result);
      }
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('history <project>')
  .description('Show analysis history for a project')
  .option('-l, --limit <number>', 'Number of analyses to show', '10')
  .action(async (projectPath: string, options) => {
    try {
      const project = projectsRepository.findByPath(projectPath);
      if (!project) {
        console.error(chalk.red(`✗ Project not found: ${projectPath}`));
        process.exit(1);
      }

      const limit = parseInt(options.limit, 10) || 10;
      const analyses = analysesRepository.findByProjectId(project.id, limit);

      console.log(chalk.blue(`\n📊 Analysis History for ${project.name}\n`));
      console.log(chalk.gray(`Path: ${project.path}`));
      console.log(chalk.gray(`Total analyses: ${project.analysisCount}\n`));

      if (analyses.length === 0) {
        console.log(chalk.yellow('No analyses found.'));
        return;
      }

      console.log(chalk.bold('ID                                    Grade  Score  Date'));
      console.log(chalk.gray('─'.repeat(70)));

      for (const a of analyses) {
        const grade = a.scores?.grade || 'N/A';
        const score = a.scores?.overall?.toFixed(0) || 'N/A';
        const date = new Date(a.startedAt).toLocaleDateString();
        const gradeColor = getGradeColor(grade);
        console.log(`${a.id}  ${gradeColor(grade.padEnd(5))}  ${score.toString().padEnd(5)}  ${date}`);
      }
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('compare <id1> <id2>')
  .description('Compare two analyses')
  .action(async (id1: string, id2: string) => {
    try {
      const analysis1 = analysesRepository.findById(id1);
      const analysis2 = analysesRepository.findById(id2);

      if (!analysis1 || !analysis2) {
        console.error(chalk.red('✗ One or both analyses not found'));
        process.exit(1);
      }

      const findings1 = findingsRepository.findByAnalysisId(id1);
      const findings2 = findingsRepository.findByAnalysisId(id2);

      console.log(chalk.blue('\n📊 Analysis Comparison\n'));

      // Score comparison
      console.log(chalk.bold('Score Changes:'));
      console.log(chalk.gray('─'.repeat(40)));

      const categories = ['overall', 'security', 'quality', 'dependencies', 'architecture'] as const;
      for (const cat of categories) {
        const score1 = analysis1.scores?.[cat] ?? 0;
        const score2 = analysis2.scores?.[cat] ?? 0;
        const diff = score2 - score1;
        const diffStr = diff > 0 ? chalk.green(`+${diff.toFixed(0)}`) : diff < 0 ? chalk.red(`${diff.toFixed(0)}`) : chalk.gray('0');
        console.log(`  ${cat.padEnd(15)} ${score1.toFixed(0).padEnd(5)} → ${score2.toFixed(0).padEnd(5)} (${diffStr})`);
      }

      // Findings comparison
      const f1Ids = new Set(findings1.map(f => `${f.ruleId}:${f.file}`));
      const f2Ids = new Set(findings2.map(f => `${f.ruleId}:${f.file}`));

      const newIssues = findings2.filter(f => !f1Ids.has(`${f.ruleId}:${f.file}`));
      const fixedIssues = findings1.filter(f => !f2Ids.has(`${f.ruleId}:${f.file}`));

      console.log(chalk.bold('\nFindings:'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  Analysis 1: ${findings1.length} findings`);
      console.log(`  Analysis 2: ${findings2.length} findings`);
      console.log(chalk.green(`  Fixed: ${fixedIssues.length}`));
      console.log(chalk.red(`  New: ${newIssues.length}`));

      if (newIssues.length > 0) {
        console.log(chalk.bold('\nNew Issues:'));
        for (const f of newIssues.slice(0, 5)) {
          console.log(chalk.red(`  - [${f.severity}] ${f.title}`));
        }
        if (newIssues.length > 5) {
          console.log(chalk.gray(`  ... and ${newIssues.length - 5} more`));
        }
      }

      if (fixedIssues.length > 0) {
        console.log(chalk.bold('\nFixed Issues:'));
        for (const f of fixedIssues.slice(0, 5)) {
          console.log(chalk.green(`  - [${f.severity}] ${f.title}`));
        }
        if (fixedIssues.length > 5) {
          console.log(chalk.gray(`  ... and ${fixedIssues.length - 5} more`));
        }
      }
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start the REST API server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .action(async (options) => {
    logger.info(`Starting REST API server on port ${options.port}`);
    console.log(chalk.yellow('\nREST API server coming soon...'));
    // TODO: Implement Fastify server
  });

program
  .command('mcp')
  .description('Start the MCP server (for Claude integration)')
  .action(async () => {
    // Import dynamically to avoid loading MCP SDK for other commands
    const { startMcpServer } = await import('../server/mcp-server.js');
    await startMcpServer();
  });

program
  .command('health')
  .description('Check health of external MCP servers')
  .action(async () => {
    console.log(chalk.blue('\n🏥 MCP Server Health Check\n'));

    try {
      const config = loadConfig();
      const registry = new McpClientRegistry(config);

      const results = await registry.healthCheck();

      console.log(chalk.bold('Server Status:'));
      console.log(chalk.gray('─'.repeat(40)));

      for (const [name, healthy] of results) {
        const status = healthy ? chalk.green('✓ Healthy') : chalk.red('✗ Unhealthy');
        console.log(`  ${name.padEnd(20)} ${status}`);
      }

      const healthyCount = [...results.values()].filter(v => v).length;
      console.log(chalk.gray('\n─'.repeat(40)));
      console.log(`${healthyCount}/${results.size} servers healthy`);
    } catch (error) {
      console.error(chalk.red(`✗ Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

// Helper functions
function getGradeColor(grade: string): (text: string) => string {
  switch (grade) {
    case 'A': return chalk.green;
    case 'B': return chalk.cyan;
    case 'C': return chalk.yellow;
    case 'D': return chalk.hex('#FFA500');
    case 'F': return chalk.red;
    default: return chalk.gray;
  }
}

function printConsoleReport(result: {
  analysis: { id: string; status: string; scores: { overall: number; security: number; quality: number; dependencies: number; architecture: number; grade: string } | null };
  project: { name: string; path: string } | null;
  findings: Array<{ severity: string; title: string; file?: string; category: string }>;
  summary: { total: number; bySeverity: Record<string, number>; byCategory: Record<string, number> };
}): void {
  const { analysis, project, findings, summary } = result;

  console.log(chalk.blue('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.blue.bold('                    ANALYSIS REPORT'));
  console.log(chalk.blue('═══════════════════════════════════════════════════════════════\n'));

  console.log(chalk.bold('Project:'), project?.name || 'Unknown');
  console.log(chalk.bold('Path:'), project?.path || 'N/A');
  console.log(chalk.bold('Analysis ID:'), analysis.id);
  console.log(chalk.bold('Status:'), analysis.status);

  if (analysis.scores) {
    const gradeColor = getGradeColor(analysis.scores.grade);
    console.log(chalk.bold('\n📈 SCORES'));
    console.log(chalk.gray('───────────────────────────────────────'));
    console.log(`  Grade:         ${gradeColor(analysis.scores.grade)}`);
    console.log(`  Overall:       ${analysis.scores.overall.toFixed(0)}/100`);
    console.log(`  Security:      ${analysis.scores.security.toFixed(0)}/100`);
    console.log(`  Quality:       ${analysis.scores.quality.toFixed(0)}/100`);
    console.log(`  Dependencies:  ${analysis.scores.dependencies.toFixed(0)}/100`);
    console.log(`  Architecture:  ${analysis.scores.architecture.toFixed(0)}/100`);
  }

  console.log(chalk.bold('\n🔍 FINDINGS SUMMARY'));
  console.log(chalk.gray('───────────────────────────────────────'));
  console.log(`  Total: ${summary.total}`);
  console.log(`  ${chalk.red('Critical:')} ${summary.bySeverity.critical || 0}`);
  console.log(`  ${chalk.hex('#FFA500')('High:')} ${summary.bySeverity.high || 0}`);
  console.log(`  ${chalk.yellow('Medium:')} ${summary.bySeverity.medium || 0}`);
  console.log(`  ${chalk.cyan('Low:')} ${summary.bySeverity.low || 0}`);
  console.log(`  ${chalk.gray('Info:')} ${summary.bySeverity.info || 0}`);

  if (findings.length > 0) {
    console.log(chalk.bold('\n⚠️  TOP ISSUES'));
    console.log(chalk.gray('───────────────────────────────────────'));

    const topFindings = findings.slice(0, 10);
    for (const f of topFindings) {
      const sevColor = f.severity === 'critical' ? chalk.red :
                       f.severity === 'high' ? chalk.hex('#FFA500') :
                       f.severity === 'medium' ? chalk.yellow : chalk.gray;
      console.log(`  ${sevColor(`[${f.severity.toUpperCase()}]`)} ${f.title}`);
      if (f.file) {
        console.log(chalk.gray(`    └─ ${f.file}`));
      }
    }

    if (findings.length > 10) {
      console.log(chalk.gray(`\n  ... and ${findings.length - 10} more issues`));
    }
  }

  console.log(chalk.blue('\n═══════════════════════════════════════════════════════════════\n'));
}

function formatMarkdownReport(result: {
  analysis: { id: string; status: string; scores: { overall: number; security: number; quality: number; dependencies: number; architecture: number; grade: string } | null };
  project: { name: string; path: string } | null;
  findings: Array<{ severity: string; title: string; file?: string; line?: number; category: string; description?: string }>;
  summary: { total: number; bySeverity: Record<string, number>; byCategory: Record<string, number> };
}): string {
  const { analysis, project, findings, summary } = result;

  const lines = [
    `# Analysis Report`,
    ``,
    `## Project: ${project?.name || 'Unknown'}`,
    `**Path:** ${project?.path || 'N/A'}`,
    `**Analysis ID:** ${analysis.id}`,
    `**Status:** ${analysis.status}`,
    `**Grade:** ${analysis.scores?.grade || 'N/A'}`,
    ``,
    `## Scores`,
    `| Category | Score |`,
    `|----------|-------|`,
    `| Overall | ${analysis.scores?.overall?.toFixed(0) ?? 'N/A'} |`,
    `| Security | ${analysis.scores?.security?.toFixed(0) ?? 'N/A'} |`,
    `| Quality | ${analysis.scores?.quality?.toFixed(0) ?? 'N/A'} |`,
    `| Dependencies | ${analysis.scores?.dependencies?.toFixed(0) ?? 'N/A'} |`,
    `| Architecture | ${analysis.scores?.architecture?.toFixed(0) ?? 'N/A'} |`,
    ``,
    `## Findings Summary`,
    `- **Total:** ${summary.total}`,
    `- **Critical:** ${summary.bySeverity.critical || 0}`,
    `- **High:** ${summary.bySeverity.high || 0}`,
    `- **Medium:** ${summary.bySeverity.medium || 0}`,
    `- **Low:** ${summary.bySeverity.low || 0}`,
    `- **Info:** ${summary.bySeverity.info || 0}`,
  ];

  if (findings.length > 0) {
    lines.push(``, `## Detailed Findings`);

    // Group by severity
    const severities = ['critical', 'high', 'medium', 'low', 'info'];
    for (const sev of severities) {
      const sevFindings = findings.filter(f => f.severity === sev);
      if (sevFindings.length > 0) {
        lines.push(``, `### ${sev.charAt(0).toUpperCase() + sev.slice(1)} (${sevFindings.length})`);
        for (const f of sevFindings) {
          lines.push(`- **${f.title}**`);
          if (f.description) {
            lines.push(`  - ${f.description}`);
          }
          if (f.file) {
            lines.push(`  - File: \`${f.file}${f.line ? `:${f.line}` : ''}\``);
          }
        }
      }
    }
  }

  return lines.join('\n');
}

program.parse();
