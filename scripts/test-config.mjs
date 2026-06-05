export const TEST_CONFIG = {
  tempDir: 'test-temp',
  reportsDir: 'test-reports',
  
  options: {
    verbose: true,
    interactive: false,
    retryOnFailure: false,
    maxRetries: 3,
    timeout: 30000,
  },
  
  scope: {
    basic: true,
    tools: true,
    workflows: true,
    scenarios: true,
    performance: true,
    codeReview: true,
    concurrent: true,
  },
  
  workflow: {
    planning: {
      requirement: '用户登录与 JWT 鉴权模块',
      outputDir: '.bmad-output',
    },
    pipeline: {
      batchName: 'test-batch',
      outputDir: '.bmad-output',
    },
  },

  codeReview: {
    lintSuccessScript: 'echo "lint passed"',
    lintFailScript: 'exit 1',
  },

  concurrent: {
    timeout: 60000,
  },

  stability: {
    duration: 2 * 60 * 60 * 1000,
    interval: 5 * 60 * 1000,
    memoryThreshold: 500 * 1024 * 1024,
    stateFileThreshold: 100 * 1024,
    logFile: 'test-reports/stability.log',
    reportFile: 'test-reports/stability-report.json',
  },
};
