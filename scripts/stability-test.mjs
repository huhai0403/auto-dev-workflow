#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { TEST_CONFIG } from './test-config.mjs';
import {
  colorize,
  log,
  createTempDir,
  cleanupTempDir,
  getMemoryUsage,
  formatBytes,
  formatDuration,
  writeLog,
  generateStabilityReport,
} from './test-utils.mjs';

let workflowEngine;
try {
  const mod = await import('../dist/engine/workflow-engine.js');
  workflowEngine = mod.workflowEngine;
} catch (err) {
  console.error(colorize('错误: 无法加载工作流引擎，请先运行 npm run build', 'red'));
  process.exit(1);
}

class StabilityTestRunner {
  constructor(options) {
    this.duration = options.duration;
    this.interval = options.interval;
    this.metrics = [];
    this.startTime = null;
    this.iteration = 0;
    this.errors = [];
  }

  async run() {
    this.displayBanner();
    await this.checkEnvironment();
    await this.runStabilityTest();
    this.generateReport();
  }

  displayBanner() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           BMAD Workflow MCP - 稳定性测试                     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\n测试时长: ${formatDuration(this.duration)}`);
    console.log(`采样间隔: ${formatDuration(this.interval)}`);
    console.log(`预计迭代: ${Math.floor(this.duration / this.interval)} 次\n`);
  }

  async checkEnvironment() {
    log('检查构建状态...', 'info');
    try {
      await fs.access('dist/index.js');
      await fs.access('dist/engine/workflow-engine.js');
      log('构建文件存在', 'success');
    } catch {
      log('构建文件不存在，请先运行 npm run build', 'error');
      process.exit(1);
    }
  }

  async runStabilityTest() {
    this.startTime = Date.now();
    const endTime = this.startTime + this.duration;

    log(`开始稳定性测试，预计结束时间: ${new Date(endTime).toLocaleString()}`, 'info');

    while (Date.now() < endTime) {
      this.iteration++;
      const remaining = endTime - Date.now();
      
      if (remaining < this.interval && this.iteration > 1) {
        log('剩余时间不足，结束测试', 'info');
        break;
      }

      await this.runIteration();
      
      if (Date.now() < endTime) {
        const waitTime = Math.min(this.interval, endTime - Date.now());
        log(`等待 ${formatDuration(waitTime)} 后进行下一次迭代...`, 'debug');
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  async runIteration() {
    const iterStart = Date.now();
    const tmpDir = await createTempDir('stability');

    try {
      const memBefore = getMemoryUsage();
      
      const result = await workflowEngine.start({
        projectRoot: tmpDir,
        outputDir: '.bmad-output',
        requirementDescription: `稳定性测试 迭代 ${this.iteration}`,
        workflowType: 'planning',
        mode: 'normal',
        includeCodegen: true,
        includeCodeReview: false,
      });

      const memAfter = getMemoryUsage();
      const duration = Date.now() - iterStart;
      const stateFile = path.join(tmpDir, '.bmad-workflow-state.json');
      let stateFileSize = 0;
      try {
        const stateStat = await fs.stat(stateFile);
        stateFileSize = stateStat.size;
      } catch {}

      const metric = {
        iteration: this.iteration,
        timestamp: new Date().toISOString(),
        success: result.state.status === 'completed',
        duration,
        memory: {
          heapUsed: memAfter.heapUsed,
          heapTotal: memAfter.heapTotal,
          rss: memAfter.rss,
        },
        stateFileSize,
        completedSteps: result.state.completedSteps.length,
      };

      this.metrics.push(metric);
      this.displayIterationStatus(metric);
      await this.writeMetricLog(metric);
      await this.checkAlerts(metric);

    } catch (err) {
      this.errors.push({
        iteration: this.iteration,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
      log(`迭代 ${this.iteration} 失败: ${err.message}`, 'error');
      await writeLog(TEST_CONFIG.stability.logFile, `ERROR iteration ${this.iteration}: ${err.message}`);
    } finally {
      await cleanupTempDir(tmpDir);
    }
  }

  displayIterationStatus(metric) {
    const status = metric.success ? colorize('✓', 'green') : colorize('✗', 'red');
    const mem = formatBytes(metric.memory.heapUsed);
    const stateSize = formatBytes(metric.stateFileSize);
    const duration = formatDuration(metric.duration);
    const elapsed = formatDuration(Date.now() - this.startTime);
    
    console.log(`[${elapsed}] 迭代 ${this.iteration}: ${status} | 内存: ${mem} | 状态文件: ${stateSize} | 耗时: ${duration}`);
  }

  async checkAlerts(metric) {
    const alerts = [];
    
    if (metric.memory.heapUsed > TEST_CONFIG.stability.memoryThreshold) {
      alerts.push(`内存使用超过阈值: ${formatBytes(metric.memory.heapUsed)} > ${formatBytes(TEST_CONFIG.stability.memoryThreshold)}`);
    }
    
    if (metric.stateFileSize > TEST_CONFIG.stability.stateFileThreshold) {
      alerts.push(`状态文件超过阈值: ${formatBytes(metric.stateFileSize)} > ${formatBytes(TEST_CONFIG.stability.stateFileThreshold)}`);
    }
    
    if (metric.duration > 30000) {
      alerts.push(`工作流耗时超过30秒: ${formatDuration(metric.duration)}`);
    }

    for (const alert of alerts) {
      log(`告警: ${alert}`, 'warn');
      await writeLog(TEST_CONFIG.stability.logFile, `ALERT: ${alert}`);
    }
  }

  async writeMetricLog(metric) {
    const logLine = JSON.stringify(metric);
    await writeLog(TEST_CONFIG.stability.logFile, logLine);
  }

  generateReport() {
    const report = generateStabilityReport(this.metrics, this.errors);
    report.startTime = new Date(this.startTime).toISOString();
    report.endTime = new Date().toISOString();
    
    this.displayReport(report);
    this.saveReport(report);
  }

  displayReport(report) {
    console.log('\n' + '═'.repeat(60));
    console.log(colorize('                        稳定性测试报告', 'bold'));
    console.log('═'.repeat(60));
    console.log(`测试时长: ${formatDuration(report.duration)}`);
    console.log(`总迭代次数: ${report.totalIterations}`);
    console.log(`成功率: ${report.successRate}%`);
    console.log(`错误次数: ${report.errors}`);
    console.log('');
    console.log('内存使用:');
    console.log(`  起始: ${formatBytes(report.memory.start)}`);
    console.log(`  结束: ${formatBytes(report.memory.end)}`);
    console.log(`  增长: ${formatBytes(report.memory.growth)} (${report.memory.growthPercent}%)`);
    console.log(`  峰值: ${formatBytes(report.memory.peak)}`);
    console.log('');
    console.log('状态文件:');
    console.log(`  起始: ${formatBytes(report.stateFile.start)}`);
    console.log(`  结束: ${formatBytes(report.stateFile.end)}`);
    console.log(`  增长: ${formatBytes(report.stateFile.growth)} (${report.stateFile.growthPercent}%)`);
    console.log('');
    console.log('性能:');
    console.log(`  平均耗时: ${formatDuration(report.performance.avg)}`);
    console.log(`  最小耗时: ${formatDuration(report.performance.min)}`);
    console.log(`  最大耗时: ${formatDuration(report.performance.max)}`);
    console.log('═'.repeat(60));
  }

  async saveReport(report) {
    try {
      await fs.mkdir(path.dirname(TEST_CONFIG.stability.reportFile), { recursive: true });
      await fs.writeFile(
        TEST_CONFIG.stability.reportFile,
        JSON.stringify(report, null, 2)
      );
      console.log(`\n详细报告: ${TEST_CONFIG.stability.reportFile}`);
    } catch (err) {
      log(`无法保存报告: ${err.message}`, 'error');
    }
  }
}

function parseDuration(str) {
  const match = str.match(/^(\d+)(h|m|s)$/);
  if (!match) return TEST_CONFIG.stability.duration;
  const value = parseInt(match[1]);
  const unit = match[2];
  switch (unit) {
    case 'h': return value * 60 * 60 * 1000;
    case 'm': return value * 60 * 1000;
    case 's': return value * 1000;
    default: return TEST_CONFIG.stability.duration;
  }
}

const args = process.argv.slice(2);
const durationArg = args.find(a => a.startsWith('--duration='));
const duration = durationArg 
  ? parseDuration(durationArg.split('=')[1])
  : TEST_CONFIG.stability.duration;

const runner = new StabilityTestRunner({
  duration,
  interval: TEST_CONFIG.stability.interval,
});

runner.run().catch((err) => {
  console.error(colorize(`\n稳定性测试错误: ${err.message}`, 'red'));
  process.exit(1);
});
