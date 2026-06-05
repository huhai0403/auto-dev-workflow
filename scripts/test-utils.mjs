import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

export function colorize(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

export function log(message, level = 'info') {
  const prefix = {
    info: colorize('[INFO]', 'blue'),
    success: colorize('[PASS]', 'green'),
    error: colorize('[FAIL]', 'red'),
    warn: colorize('[WARN]', 'yellow'),
    debug: colorize('[DEBUG]', 'cyan'),
  };
  console.log(`${prefix[level] || prefix.info} ${message}`);
}

export async function createTempDir(name = 'bmad-test') {
  const tmpDir = path.join(os.tmpdir(), `${name}-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

export async function cleanupTempDir(tmpDir) {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch (err) {
    log(`Failed to cleanup temp dir: ${err.message}`, 'warn');
  }
}

export async function waitForUserInput(prompt = '按 Enter 继续...') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

export async function runWithTimeout(fnOrPromise, timeout = 30000) {
  const promise = typeof fnOrPromise === 'function' ? fnOrPromise() : fnOrPromise;
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
    ),
  ]);
}

export async function retryOperation(fn, maxRetries = 3) {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < maxRetries) {
        log(`Retry ${i + 1}/${maxRetries}: ${err.message}`, 'warn');
      }
    }
  }
  throw lastError;
}

export function formatResult(success, message, duration = 0) {
  const status = success ? colorize('PASS', 'green') : colorize('FAIL', 'red');
  return {
    status,
    success,
    message,
    duration,
    timestamp: new Date().toISOString(),
  };
}

export function displayProgress(current, total, testName) {
  const progress = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
  console.log(`\n${colorize(`[${current}/${total}]`, 'cyan')} ${testName}`);
  console.log(`  Progress: ${bar} ${progress}%`);
}

export function generateReport(results) {
  const total = results.length;
  const passed = results.filter(r => r.success).length;
  const failed = total - passed;
  const passRate = Math.round((passed / total) * 100);

  const report = {
    summary: { total, passed, failed, passRate },
    results,
    timestamp: new Date().toISOString(),
  };

  return report;
}

export function displayReport(report) {
  const { summary } = report;
  
  console.log('\n' + '═'.repeat(60));
  console.log(colorize('                        测试报告摘要', 'bold'));
  console.log('═'.repeat(60));
  console.log(`总计: ${summary.total} 个测试`);
  console.log(`${colorize(`通过: ${summary.passed} 个 (${summary.passRate}%)`, 'green')}`);
  if (summary.failed > 0) {
    console.log(`${colorize(`失败: ${summary.failed} 个`, 'red')}`);
  }
  
  const failedTests = report.results.filter(r => !r.success);
  if (failedTests.length > 0) {
    console.log('\n失败详情:');
    failedTests.forEach((test, i) => {
      console.log(`  ${i + 1}. ${test.name}`);
      console.log(`     错误: ${test.message}`);
    });
  }
  
  console.log('═'.repeat(60));
}

export function getMemoryUsage() {
  return process.memoryUsage();
}

export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

export async function writeLog(logFile, message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  await fs.appendFile(logFile, logLine, 'utf-8');
}

export function generateStabilityReport(metrics, errors) {
  if (metrics.length === 0) {
    return {
      duration: 0,
      totalIterations: 0,
      successRate: 0,
      errors: errors.length,
      memory: { start: 0, end: 0, growth: 0, growthPercent: 0, peak: 0 },
      stateFile: { start: 0, end: 0, growth: 0, growthPercent: 0 },
      performance: { avg: 0, min: 0, max: 0 },
    };
  }

  const durations = metrics.map(m => m.duration);
  const memoryUsages = metrics.map(m => m.memory.heapUsed);
  const stateFileSizes = metrics.map(m => m.stateFileSize);

  const startMemory = memoryUsages[0];
  const endMemory = memoryUsages[memoryUsages.length - 1];
  const memoryGrowth = endMemory - startMemory;

  const startStateFile = stateFileSizes[0];
  const endStateFile = stateFileSizes[stateFileSizes.length - 1];
  const stateFileGrowth = endStateFile - startStateFile;

  const startTime = new Date(metrics[0].timestamp).getTime();
  const endTime = new Date(metrics[metrics.length - 1].timestamp).getTime();

  return {
    duration: endTime - startTime,
    totalIterations: metrics.length,
    successRate: Math.round((metrics.filter(m => m.success).length / metrics.length) * 100),
    errors: errors.length,
    memory: {
      start: startMemory,
      end: endMemory,
      growth: memoryGrowth,
      growthPercent: startMemory > 0 ? Math.round((memoryGrowth / startMemory) * 100) : 0,
      peak: Math.max(...memoryUsages),
    },
    stateFile: {
      start: startStateFile,
      end: endStateFile,
      growth: stateFileGrowth,
      growthPercent: startStateFile > 0 ? Math.round((stateFileGrowth / startStateFile) * 100) : 0,
    },
    performance: {
      avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      min: Math.min(...durations),
      max: Math.max(...durations),
    },
    metrics,
    errors,
  };
}
