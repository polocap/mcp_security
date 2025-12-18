import { logger } from '../utils/logger.js';
import type { Analysis, Project } from '../types/analysis.js';
import type { NormalizedFinding, FindingsSummary } from '../types/findings.js';
import type { CodeGraph } from '../types/graph.js';

const reportLogger = logger.child('html-generator');

export interface HtmlReportData {
  analysis: Analysis;
  project: Project | null;
  findings: NormalizedFinding[];
  summary: FindingsSummary;
  graph?: CodeGraph;
}

export function generateHtmlReport(data: HtmlReportData): string {
  reportLogger.info(`Generating HTML report for analysis ${data.analysis.id}`);

  const { analysis, project, findings, summary, graph } = data;

  // Group findings by severity
  const findingsBySeverity = {
    critical: [] as NormalizedFinding[],
    high: [] as NormalizedFinding[],
    medium: [] as NormalizedFinding[],
    low: [] as NormalizedFinding[],
    info: [] as NormalizedFinding[],
  };
  for (const f of findings) {
    const arr = findingsBySeverity[f.severity as keyof typeof findingsBySeverity];
    if (arr) {
      arr.push(f);
    }
  }

  // Group findings by category
  const findingsByCategory = {
    security: [] as NormalizedFinding[],
    quality: [] as NormalizedFinding[],
    dependencies: [] as NormalizedFinding[],
    architecture: [] as NormalizedFinding[],
  };
  for (const f of findings) {
    const arr = findingsByCategory[f.category as keyof typeof findingsByCategory];
    if (arr) {
      arr.push(f);
    }
  }

  const gradeColor = getGradeColor(analysis.scores?.grade || 'N/A');
  const severityData = JSON.stringify([
    summary.bySeverity.critical || 0,
    summary.bySeverity.high || 0,
    summary.bySeverity.medium || 0,
    summary.bySeverity.low || 0,
    summary.bySeverity.info || 0,
  ]);
  const categoryData = JSON.stringify([
    summary.byCategory.security || 0,
    summary.byCategory.quality || 0,
    summary.byCategory.dependencies || 0,
    summary.byCategory.architecture || 0,
  ]);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analysis Report - ${project?.name || 'Unknown'}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --text-primary: #f0f6fc;
      --text-secondary: #8b949e;
      --border-color: #30363d;
      --accent-blue: #58a6ff;
      --accent-green: #3fb950;
      --accent-yellow: #d29922;
      --accent-orange: #db6d28;
      --accent-red: #f85149;
      --accent-purple: #a371f7;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }

    header {
      background: linear-gradient(135deg, var(--bg-secondary), var(--bg-tertiary));
      border-bottom: 1px solid var(--border-color);
      padding: 2rem;
      margin-bottom: 2rem;
      border-radius: 12px;
    }

    header h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    header p {
      color: var(--text-secondary);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.5rem;
    }

    .card h2 {
      font-size: 1.1rem;
      color: var(--text-secondary);
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .grade-display {
      text-align: center;
      padding: 2rem;
    }

    .grade-circle {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1rem;
      font-size: 3rem;
      font-weight: bold;
      background: ${gradeColor}22;
      color: ${gradeColor};
      border: 4px solid ${gradeColor};
    }

    .score-bar {
      display: flex;
      align-items: center;
      margin-bottom: 0.75rem;
    }

    .score-label {
      width: 120px;
      font-size: 0.9rem;
      color: var(--text-secondary);
    }

    .score-track {
      flex: 1;
      height: 8px;
      background: var(--bg-tertiary);
      border-radius: 4px;
      overflow: hidden;
    }

    .score-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s ease;
    }

    .score-value {
      width: 50px;
      text-align: right;
      font-weight: bold;
      font-size: 0.9rem;
    }

    .chart-container {
      position: relative;
      height: 250px;
    }

    .findings-list {
      max-height: 500px;
      overflow-y: auto;
    }

    .finding-item {
      background: var(--bg-tertiary);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
      border-left: 4px solid;
    }

    .finding-item.critical { border-color: var(--accent-red); }
    .finding-item.high { border-color: var(--accent-orange); }
    .finding-item.medium { border-color: var(--accent-yellow); }
    .finding-item.low { border-color: var(--accent-blue); }
    .finding-item.info { border-color: var(--text-secondary); }

    .finding-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.5rem;
    }

    .finding-title {
      font-weight: 600;
      color: var(--text-primary);
    }

    .severity-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .severity-badge.critical { background: var(--accent-red); color: white; }
    .severity-badge.high { background: var(--accent-orange); color: white; }
    .severity-badge.medium { background: var(--accent-yellow); color: black; }
    .severity-badge.low { background: var(--accent-blue); color: white; }
    .severity-badge.info { background: var(--text-secondary); color: white; }

    .finding-meta {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }

    .finding-file {
      font-family: monospace;
      background: var(--bg-primary);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }

    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.5rem;
    }

    .tab {
      padding: 0.5rem 1rem;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      border-radius: 6px;
      font-size: 0.9rem;
    }

    .tab:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    .tab.active {
      background: var(--accent-blue);
      color: white;
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .stats-row {
      display: flex;
      justify-content: space-around;
      text-align: center;
      padding: 1rem 0;
    }

    .stat-item {
      padding: 0 1rem;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: bold;
      color: var(--accent-blue);
    }

    .stat-label {
      font-size: 0.85rem;
      color: var(--text-secondary);
    }

    footer {
      text-align: center;
      padding: 2rem;
      color: var(--text-secondary);
      font-size: 0.85rem;
    }

    @media (max-width: 768px) {
      .container { padding: 1rem; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 Analysis Report</h1>
      <p><strong>Project:</strong> ${escapeHtml(project?.name || 'Unknown')} |
         <strong>Path:</strong> ${escapeHtml(project?.path || 'N/A')} |
         <strong>Date:</strong> ${new Date(analysis.startedAt).toLocaleString()}</p>
      <p><strong>Analysis ID:</strong> <code>${analysis.id}</code></p>
    </header>

    <div class="grid">
      <div class="card grade-display">
        <h2>Overall Grade</h2>
        <div class="grade-circle">${analysis.scores?.grade || 'N/A'}</div>
        <p>Score: ${analysis.scores?.overall?.toFixed(0) || 'N/A'}/100</p>
      </div>

      <div class="card">
        <h2>Scores by Category</h2>
        ${generateScoreBar('Security', analysis.scores?.security || 0, getScoreColor(analysis.scores?.security || 0))}
        ${generateScoreBar('Quality', analysis.scores?.quality || 0, getScoreColor(analysis.scores?.quality || 0))}
        ${generateScoreBar('Dependencies', analysis.scores?.dependencies || 0, getScoreColor(analysis.scores?.dependencies || 0))}
        ${generateScoreBar('Architecture', analysis.scores?.architecture || 0, getScoreColor(analysis.scores?.architecture || 0))}
      </div>

      <div class="card">
        <h2>Findings Summary</h2>
        <div class="stats-row">
          <div class="stat-item">
            <div class="stat-value">${summary.total}</div>
            <div class="stat-label">Total Issues</div>
          </div>
          <div class="stat-item">
            <div class="stat-value" style="color: var(--accent-red)">${summary.bySeverity.critical || 0}</div>
            <div class="stat-label">Critical</div>
          </div>
          <div class="stat-item">
            <div class="stat-value" style="color: var(--accent-orange)">${summary.bySeverity.high || 0}</div>
            <div class="stat-label">High</div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <h2>Findings by Severity</h2>
        <div class="chart-container">
          <canvas id="severityChart"></canvas>
        </div>
      </div>

      <div class="card">
        <h2>Findings by Category</h2>
        <div class="chart-container">
          <canvas id="categoryChart"></canvas>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Detailed Findings</h2>
      <div class="tabs">
        <button class="tab active" onclick="showTab('all')">All (${findings.length})</button>
        <button class="tab" onclick="showTab('critical')">Critical (${findingsBySeverity.critical.length})</button>
        <button class="tab" onclick="showTab('high')">High (${findingsBySeverity.high.length})</button>
        <button class="tab" onclick="showTab('medium')">Medium (${findingsBySeverity.medium.length})</button>
        <button class="tab" onclick="showTab('low')">Low (${findingsBySeverity.low.length})</button>
      </div>

      <div id="tab-all" class="tab-content active">
        <div class="findings-list">
          ${generateFindingsList(findings)}
        </div>
      </div>

      <div id="tab-critical" class="tab-content">
        <div class="findings-list">
          ${generateFindingsList(findingsBySeverity.critical)}
        </div>
      </div>

      <div id="tab-high" class="tab-content">
        <div class="findings-list">
          ${generateFindingsList(findingsBySeverity.high)}
        </div>
      </div>

      <div id="tab-medium" class="tab-content">
        <div class="findings-list">
          ${generateFindingsList(findingsBySeverity.medium)}
        </div>
      </div>

      <div id="tab-low" class="tab-content">
        <div class="findings-list">
          ${generateFindingsList(findingsBySeverity.low)}
        </div>
      </div>
    </div>

    ${graph ? generateGraphSection(graph) : ''}

    <footer>
      <p>Generated by MCP Code Analyzer v0.1.0</p>
      <p>Analysis completed at ${analysis.completedAt ? new Date(analysis.completedAt).toLocaleString() : 'N/A'}</p>
    </footer>
  </div>

  <script>
    // Severity Chart
    new Chart(document.getElementById('severityChart'), {
      type: 'doughnut',
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low', 'Info'],
        datasets: [{
          data: ${severityData},
          backgroundColor: ['#f85149', '#db6d28', '#d29922', '#58a6ff', '#8b949e'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#f0f6fc' }
          }
        }
      }
    });

    // Category Chart
    new Chart(document.getElementById('categoryChart'), {
      type: 'bar',
      data: {
        labels: ['Security', 'Quality', 'Dependencies', 'Architecture'],
        datasets: [{
          data: ${categoryData},
          backgroundColor: ['#f85149', '#58a6ff', '#d29922', '#a371f7'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: '#8b949e' },
            grid: { color: '#30363d' }
          },
          x: {
            ticks: { color: '#8b949e' },
            grid: { display: false }
          }
        }
      }
    });

    // Tab functionality
    function showTab(tabName) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + tabName).classList.add('active');
      event.target.classList.add('active');
    }
  </script>
</body>
</html>`;

  reportLogger.debug(`Generated HTML report: ${html.length} bytes`);
  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getGradeColor(grade: string): string {
  switch (grade) {
    case 'A': return '#3fb950';
    case 'B': return '#58a6ff';
    case 'C': return '#d29922';
    case 'D': return '#db6d28';
    case 'F': return '#f85149';
    default: return '#8b949e';
  }
}

function getScoreColor(score: number): string {
  if (score >= 90) return '#3fb950';
  if (score >= 80) return '#58a6ff';
  if (score >= 70) return '#d29922';
  if (score >= 60) return '#db6d28';
  return '#f85149';
}

function generateScoreBar(label: string, score: number, color: string): string {
  return `
    <div class="score-bar">
      <span class="score-label">${label}</span>
      <div class="score-track">
        <div class="score-fill" style="width: ${score}%; background: ${color}"></div>
      </div>
      <span class="score-value" style="color: ${color}">${score.toFixed(0)}</span>
    </div>
  `;
}

function generateFindingsList(findings: NormalizedFinding[]): string {
  if (findings.length === 0) {
    return '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">No findings in this category</p>';
  }

  return findings.map(f => `
    <div class="finding-item ${f.severity}">
      <div class="finding-header">
        <span class="finding-title">${escapeHtml(f.title)}</span>
        <span class="severity-badge ${f.severity}">${f.severity}</span>
      </div>
      <div class="finding-meta">
        <p>${escapeHtml(f.description || 'No description')}</p>
        ${f.file ? `<p class="finding-file">${escapeHtml(f.file)}${f.line ? `:${f.line}` : ''}</p>` : ''}
        ${f.cwe ? `<p>CWE: ${escapeHtml(f.cwe)}</p>` : ''}
        ${f.remediation ? `<p><strong>Fix:</strong> ${escapeHtml(f.remediation)}</p>` : ''}
      </div>
    </div>
  `).join('');
}

function generateGraphSection(graph: CodeGraph): string {
  return `
    <div class="card" style="margin-top: 1.5rem;">
      <h2>Code Graph Statistics</h2>
      <div class="stats-row">
        <div class="stat-item">
          <div class="stat-value">${graph.stats.totalNodes}</div>
          <div class="stat-label">Total Nodes</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${graph.stats.totalEdges}</div>
          <div class="stat-label">Total Edges</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${graph.stats.nodesByType.module || 0}</div>
          <div class="stat-label">Modules</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${graph.stats.nodesByType.function || 0}</div>
          <div class="stat-label">Functions</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${graph.stats.nodesByType.class || 0}</div>
          <div class="stat-label">Classes</div>
        </div>
      </div>
    </div>
  `;
}
