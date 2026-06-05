#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { TEST_CONFIG } from './test-config.mjs';
import {
  colorize,
  log,
  createTempDir,
  cleanupTempDir,
  waitForUserInput,
  runWithTimeout,
  formatResult,
  displayProgress,
  generateReport,
  displayReport,
} from './test-utils.mjs';

let workflowEngine;
try {
  const mod = await import('../dist/engine/workflow-engine.js');
  workflowEngine = mod.workflowEngine;
} catch (err) {
  console.error(colorize('错误: 无法加载工作流引擎，请先运行 npm run build', 'red'));
  process.exit(1);
}

class InteractiveTestSuite {
  constructor() {
    this.results = [];
    this.currentTest = 0;
    this.totalTests = 0;
    this.tmpDir = null;
    this.startTime = null;
  }

  async run() {
    this.displayBanner();
    await this.checkEnvironment();
    await this.runAllTests();
    this.displayFinalReport();
  }

  displayBanner() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           BMAD Workflow MCP - 交互式测试套件                  ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('测试环境:');
    console.log(`- Node.js: ${process.version}`);
    console.log(`- 平台: ${process.platform}`);
    console.log(`- 时间: ${new Date().toLocaleString()}`);
    console.log('');
  }

  async checkEnvironment() {
    log('检查构建状态...', 'info');
    try {
      await fs.access('dist/index.js');
      log('构建文件存在', 'success');
    } catch {
      log('构建文件不存在，请先运行 npm run build', 'error');
      process.exit(1);
    }
  }

  async runAllTests() {
    this.tmpDir = await createTempDir();
    this.startTime = Date.now();

    const testSuites = [
      { name: '基础测试', fn: () => this.runBasicTests(), enabled: TEST_CONFIG.scope.basic },
      { name: '工具测试', fn: () => this.runToolTests(), enabled: TEST_CONFIG.scope.tools },
      { name: '工作流测试', fn: () => this.runWorkflowTests(), enabled: TEST_CONFIG.scope.workflows },
      { name: '场景测试', fn: () => this.runScenarioTests(), enabled: TEST_CONFIG.scope.scenarios },
      { name: '性能测试', fn: () => this.runPerformanceTests(), enabled: TEST_CONFIG.scope.performance },
      { name: '代码审查测试', fn: () => this.runCodeReviewTests(), enabled: TEST_CONFIG.scope.codeReview },
      { name: '并发测试', fn: () => this.runConcurrentTests(), enabled: TEST_CONFIG.scope.concurrent },
    ];

    for (const suite of testSuites) {
      if (suite.enabled) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(colorize(`测试套件: ${suite.name}`, 'bold'));
        console.log('─'.repeat(60));
        await suite.fn();
      }
    }

    await cleanupTempDir(this.tmpDir);
  }

  async runBasicTests() {
    await this.runTest('环境检查', async () => {
      const nodeVersion = process.version;
      if (!nodeVersion.startsWith('v18') && !nodeVersion.startsWith('v20')) {
        throw new Error(`Node.js 版本过低: ${nodeVersion}`);
      }
      return `Node.js ${nodeVersion}`;
    });

    await this.runTest('构建状态验证', async () => {
      await fs.access('dist/index.js');
      await fs.access('dist/server.js');
      await fs.access('dist/engine/workflow-engine.js');
      return '所有构建文件存在';
    });

    await this.runTest('依赖检查', async () => {
      await fs.access('node_modules/@modelcontextprotocol/sdk');
      await fs.access('node_modules/zod');
      return '依赖完整';
    });

    await this.runTest('临时目录创建', async () => {
      await fs.access(this.tmpDir);
      return `临时目录: ${this.tmpDir}`;
    });
  }

  async runToolTests() {
    await this.runTest('list_bmad_batches (空目录)', async () => {
      const batches = await workflowEngine.listBatches({
        projectRoot: this.tmpDir,
        outputDir: '.bmad-output',
      });
      if (batches.length !== 0) {
        throw new Error(`期望 0 个批次，实际 ${batches.length}`);
      }
      return '返回空数组';
    });

    await this.runTest('start_bmad_workflow (dry-run)', async () => {
      const result = await workflowEngine.start({
        projectRoot: this.tmpDir,
        outputDir: '.bmad-output',
        requirementDescription: TEST_CONFIG.workflow.planning.requirement,
        workflowType: 'planning',
        mode: 'dry-run',
      });
      if (result.state.status !== 'completed') {
        throw new Error(`期望状态 completed，实际 ${result.state.status}`);
      }
      if (!result.dryRunPreview || result.dryRunPreview.length === 0) {
        throw new Error('dry-run 预览为空');
      }
      return `生成 ${result.dryRunPreview.length} 个步骤预览`;
    });

    await this.runTest('start_bmad_workflow (正常模式)', async () => {
      const result = await workflowEngine.start({
        projectRoot: this.tmpDir,
        outputDir: '.bmad-output',
        requirementDescription: TEST_CONFIG.workflow.planning.requirement,
        workflowType: 'planning',
        mode: 'normal',
        includeCodegen: true,
        includeCodeReview: false,
      });
      if (result.state.status !== 'completed') {
        throw new Error(`期望状态 completed，实际 ${result.state.status}`);
      }
      return `完成 ${result.state.completedSteps.length} 个步骤`;
    });

    await this.runTest('get_workflow_status', async () => {
      const status = await workflowEngine.getStatus(this.tmpDir);
      if (!status) {
        throw new Error('未找到工作流状态');
      }
      if (status.status !== 'completed') {
        throw new Error(`期望状态 completed，实际 ${status.status}`);
      }
      return `状态: ${status.status}, 进度: ${status.progressPercent}%`;
    });

    await this.runTest('resume_bmad_workflow (已完成)', async () => {
      const result = await workflowEngine.resume(this.tmpDir);
      if (result.state.status !== 'completed') {
        throw new Error(`期望状态 completed，实际 ${result.state.status}`);
      }
      return '已恢复完成的工作流';
    });

    const cancelDir = await createTempDir('bmad-cancel');
    try {
      await this.runTest('cancel_workflow', async () => {
        const startPromise = workflowEngine.start({
          projectRoot: cancelDir,
          outputDir: '.bmad-output',
          requirementDescription: '测试取消',
          workflowType: 'planning',
          mode: 'normal',
        }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 500));
        const state = await workflowEngine.cancel(cancelDir);
        if (state.status !== 'cancelled') {
          throw new Error(`期望状态 cancelled，实际 ${state.status}`);
        }
        return '工作流已取消';
      });
    } finally {
      await cleanupTempDir(cancelDir);
    }
  }

  async runWorkflowTests() {
    await this.runTest('Planning 完整流程', async () => {
      const planDir = await createTempDir('bmad-plan');
      try {
        const result = await workflowEngine.start({
          projectRoot: planDir,
          outputDir: '.bmad-output',
          requirementDescription: TEST_CONFIG.workflow.planning.requirement,
          workflowType: 'planning',
          mode: 'normal',
          includeCodegen: true,
          includeCodeReview: false,
        });
        if (result.state.status !== 'completed') {
          throw new Error(`期望状态 completed，实际 ${result.state.status}`);
        }
        const outDir = path.join(planDir, '.bmad-output');
        const files = await fs.readdir(outDir);
        return `完成 ${result.state.completedSteps.length} 步，生成 ${files.length} 个文件`;
      } finally {
        await cleanupTempDir(planDir);
      }
    });

    await this.runTest('Planning 中断恢复', async () => {
      const resumeDir = await createTempDir('bmad-resume');
      try {
        const stateFile = path.join(resumeDir, '.bmad-workflow-state.json');
        const state = {
          workflowId: 'test-resume',
          workflowType: 'planning',
          projectRoot: resumeDir,
          outputDir: path.join(resumeDir, '.bmad-output'),
          requirementDescription: '测试恢复',
          mode: 'normal',
          status: 'running',
          currentStep: 'user_stories',
          completedSteps: ['discovery'],
          skippedSteps: [],
          includeCodegen: true,
          includeCodeReview: false,
          useLlm: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          cancelRequested: false,
          auditLog: [],
          artifacts: {},
        };
        await fs.mkdir(path.dirname(stateFile), { recursive: true });
        await fs.writeFile(stateFile, JSON.stringify(state, null, 2));
        await fs.mkdir(path.join(resumeDir, '.bmad-output'), { recursive: true });

        const result = await workflowEngine.resume(resumeDir);
        if (result.state.status !== 'completed') {
          throw new Error(`期望状态 completed，实际 ${result.state.status}`);
        }
        if (!result.state.completedSteps.includes('discovery')) {
          throw new Error('未保留已完成步骤');
        }
        return `从 ${result.state.completedSteps[0]} 恢复完成`;
      } finally {
        await cleanupTempDir(resumeDir);
      }
    });

    await this.runTest('Pipeline 完整流程', async () => {
      const pipeDir = await createTempDir('bmad-pipe');
      try {
        const batchName = TEST_CONFIG.workflow.pipeline.batchName;
        const outDir = path.join(pipeDir, '.bmad-output');
        const planningDir = path.join(outDir, 'planning-artifacts', batchName);
        const implDir = path.join(outDir, 'implementation-artifacts', batchName);
        await fs.mkdir(planningDir, { recursive: true });
        await fs.mkdir(implDir, { recursive: true });
        await fs.writeFile(path.join(planningDir, 'prd-test.md'), '# PRD\n', 'utf-8');
        await fs.writeFile(
          path.join(implDir, 'sprint-status-test.md'),
          `## Development Status\n\n### Epic 1: Test\n\n| Key | Story | Status | Sprint | Priority |\n|-----|-------|--------|--------|----------|\n| 1-1 | Test story | ready-for-dev | 1 | High |\n`,
          'utf-8'
        );

        const result = await workflowEngine.start({
          projectRoot: pipeDir,
          outputDir: '.bmad-output',
          workflowType: 'pipeline',
          batch: batchName,
          mode: 'normal',
        });
        if (result.state.status !== 'completed') {
          throw new Error(`期望状态 completed，实际 ${result.state.status}`);
        }
        return `完成 ${result.state.completedSteps.length} 步`;
      } finally {
        await cleanupTempDir(pipeDir);
      }
    });

    await this.runTest('list_bmad_batches (有数据)', async () => {
      const batchDir = await createTempDir('bmad-batch');
      try {
        const batchName = 'test-batch';
        const outDir = path.join(batchDir, '.bmad-output');
        const planningDir = path.join(outDir, 'planning-artifacts', batchName);
        await fs.mkdir(planningDir, { recursive: true });
        await fs.writeFile(path.join(planningDir, 'prd.md'), '# PRD\n', 'utf-8');

        const batches = await workflowEngine.listBatches({
          projectRoot: batchDir,
          outputDir: '.bmad-output',
        });
        if (batches.length === 0) {
          throw new Error('期望至少 1 个批次');
        }
        return `找到 ${batches.length} 个批次`;
      } finally {
        await cleanupTempDir(batchDir);
      }
    });
  }

  async runScenarioTests() {
    await this.runTest('缺少必填参数', async () => {
      try {
        await workflowEngine.start({
          projectRoot: this.tmpDir,
          outputDir: '.bmad-output',
          workflowType: 'planning',
        });
        throw new Error('应抛出错误但未抛出');
      } catch (err) {
        if (err.message.includes('应抛出错误')) throw err;
        return `正确抛出错误: ${err.message}`;
      }
    });

    await this.runTest('无效工作流类型', async () => {
      try {
        await workflowEngine.start({
          projectRoot: this.tmpDir,
          outputDir: '.bmad-output',
          requirementDescription: 'test',
          workflowType: 'invalid',
        });
        throw new Error('应抛出错误但未抛出');
      } catch (err) {
        if (err.message.includes('应抛出错误')) throw err;
        return `正确抛出错误`;
      }
    });

    await this.runTest('重复启动工作流', async () => {
      const dupDir = await createTempDir('bmad-dup');
      try {
        await workflowEngine.start({
          projectRoot: dupDir,
          outputDir: '.bmad-output',
          requirementDescription: 'test',
          workflowType: 'planning',
          mode: 'dry-run',
        });
        await workflowEngine.start({
          projectRoot: dupDir,
          outputDir: '.bmad-output',
          requirementDescription: 'test',
          workflowType: 'planning',
          mode: 'dry-run',
        });
        return 'dry-run 模式允许重复启动';
      } catch (err) {
        return `正确抛出错误: ${err.message}`;
      } finally {
        await cleanupTempDir(dupDir);
      }
    });

    await this.runTest('取消不存在的工作流', async () => {
      const noDir = await createTempDir('bmad-no');
      try {
        await workflowEngine.cancel(noDir);
        throw new Error('应抛出错误但未抛出');
      } catch (err) {
        if (err.message.includes('应抛出错误')) throw err;
        return `正确抛出错误: ${err.message}`;
      } finally {
        await cleanupTempDir(noDir);
      }
    });

    await this.runTest('恢复不存在的工作流', async () => {
      const noDir = await createTempDir('bmad-no-resume');
      try {
        await workflowEngine.resume(noDir);
        throw new Error('应抛出错误但未抛出');
      } catch (err) {
        if (err.message.includes('应抛出错误')) throw err;
        return `正确抛出错误: ${err.message}`;
      } finally {
        await cleanupTempDir(noDir);
      }
    });
  }

  async runPerformanceTests() {
    await this.runTest('单步执行时间', async () => {
      const perfDir = await createTempDir('bmad-perf');
      try {
        const start = Date.now();
        await workflowEngine.start({
          projectRoot: perfDir,
          outputDir: '.bmad-output',
          requirementDescription: '性能测试',
          workflowType: 'planning',
          mode: 'dry-run',
        });
        const duration = Date.now() - start;
        return `dry-run 耗时: ${duration}ms`;
      } finally {
        await cleanupTempDir(perfDir);
      }
    });

    await this.runTest('完整工作流时间', async () => {
      const perfDir = await createTempDir('bmad-perf-full');
      try {
        const start = Date.now();
        await workflowEngine.start({
          projectRoot: perfDir,
          outputDir: '.bmad-output',
          requirementDescription: '性能测试完整流程',
          workflowType: 'planning',
          mode: 'normal',
          includeCodegen: true,
          includeCodeReview: false,
        });
        const duration = Date.now() - start;
        return `完整流程耗时: ${duration}ms`;
      } finally {
        await cleanupTempDir(perfDir);
      }
    });

    await this.runTest('状态文件大小', async () => {
      const sizeDir = await createTempDir('bmad-size');
      try {
        await workflowEngine.start({
          projectRoot: sizeDir,
          outputDir: '.bmad-output',
          requirementDescription: '状态文件大小测试',
          workflowType: 'planning',
          mode: 'normal',
          includeCodegen: true,
          includeCodeReview: false,
        });
        const stateFile = path.join(sizeDir, '.bmad-workflow-state.json');
        const stat = await fs.stat(stateFile);
        return `状态文件大小: ${stat.size} bytes`;
      } finally {
        await cleanupTempDir(sizeDir);
      }
    });
  }

  async runCodeReviewTests() {
    await this.runTest('有lint脚本且成功', async () => {
      const testDir = await createTempDir('code-review-success');
      try {
        await fs.writeFile(
          path.join(testDir, 'package.json'),
          JSON.stringify({ scripts: { lint: TEST_CONFIG.codeReview.lintSuccessScript } })
        );
        const result = await workflowEngine.start({
          projectRoot: testDir,
          outputDir: '.bmad-output',
          requirementDescription: '代码审查测试',
          workflowType: 'planning',
          mode: 'normal',
          includeCodegen: false,
          includeCodeReview: true,
        });
        if (result.state.status !== 'completed') {
          throw new Error(`期望状态 completed，实际 ${result.state.status}`);
        }
        if (!result.state.completedSteps.includes('code_review')) {
          throw new Error('code_review 步骤未完成');
        }
        return `code_review 步骤完成，共 ${result.state.completedSteps.length} 步`;
      } finally {
        await cleanupTempDir(testDir);
      }
    });

    await this.runTest('有lint脚本且失败', async () => {
      const testDir = await createTempDir('code-review-fail');
      try {
        await fs.writeFile(
          path.join(testDir, 'package.json'),
          JSON.stringify({ scripts: { lint: TEST_CONFIG.codeReview.lintFailScript } })
        );
        const result = await workflowEngine.start({
          projectRoot: testDir,
          outputDir: '.bmad-output',
          requirementDescription: '代码审查失败测试',
          workflowType: 'planning',
          mode: 'normal',
          includeCodegen: false,
          includeCodeReview: true,
        });
        if (result.state.status !== 'completed') {
          throw new Error(`期望状态 completed，实际 ${result.state.status}`);
        }
        return `lint 失败后仍完成，步骤: ${result.state.completedSteps.length}`;
      } finally {
        await cleanupTempDir(testDir);
      }
    });

    await this.runTest('没有lint脚本', async () => {
      const testDir = await createTempDir('code-review-no-lint');
      try {
        await fs.writeFile(
          path.join(testDir, 'package.json'),
          JSON.stringify({ scripts: {} })
        );
        const result = await workflowEngine.start({
          projectRoot: testDir,
          outputDir: '.bmad-output',
          requirementDescription: '无lint脚本测试',
          workflowType: 'planning',
          mode: 'normal',
          includeCodegen: false,
          includeCodeReview: true,
        });
        if (result.state.status !== 'completed') {
          throw new Error(`期望状态 completed，实际 ${result.state.status}`);
        }
        return `无 lint 脚本仍完成，步骤: ${result.state.completedSteps.length}`;
      } finally {
        await cleanupTempDir(testDir);
      }
    });

    await this.runTest('禁用代码审查', async () => {
      const testDir = await createTempDir('code-review-disabled');
      try {
        const result = await workflowEngine.start({
          projectRoot: testDir,
          outputDir: '.bmad-output',
          requirementDescription: '禁用代码审查测试',
          workflowType: 'planning',
          mode: 'normal',
          includeCodegen: false,
          includeCodeReview: false,
        });
        if (result.state.status !== 'completed') {
          throw new Error(`期望状态 completed，实际 ${result.state.status}`);
        }
        if (result.state.skippedSteps.includes('code_review')) {
          return 'code_review 步骤已跳过';
        }
        return `完成 ${result.state.completedSteps.length} 步`;
      } finally {
        await cleanupTempDir(testDir);
      }
    });
  }

  async runConcurrentTests() {
    await this.runTest('同项目并发', async () => {
      const testDir = await createTempDir('concurrent-same');
      try {
        const promise1 = workflowEngine.start({
          projectRoot: testDir,
          outputDir: '.bmad-output',
          requirementDescription: '并发测试1',
          workflowType: 'planning',
          mode: 'normal',
          includeCodegen: false,
          includeCodeReview: false,
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        const promise2 = workflowEngine.start({
          projectRoot: testDir,
          outputDir: '.bmad-output',
          requirementDescription: '并发测试2',
          workflowType: 'planning',
          mode: 'normal',
          includeCodegen: false,
          includeCodeReview: false,
        });
        try {
          await Promise.all([promise1, promise2]);
          throw new Error('应抛出错误但未抛出');
        } catch (err) {
          if (err.message.includes('应抛出错误')) throw err;
          return `正确抛出错误: ${err.message}`;
        }
      } finally {
        await cleanupTempDir(testDir);
      }
    });

    await this.runTest('不同项目并发', async () => {
      const dir1 = await createTempDir('concurrent-diff-1');
      const dir2 = await createTempDir('concurrent-diff-2');
      try {
        const [result1, result2] = await Promise.all([
          workflowEngine.start({
            projectRoot: dir1,
            outputDir: '.bmad-output',
            requirementDescription: '并发测试项目1',
            workflowType: 'planning',
            mode: 'normal',
            includeCodegen: false,
            includeCodeReview: false,
          }),
          workflowEngine.start({
            projectRoot: dir2,
            outputDir: '.bmad-output',
            requirementDescription: '并发测试项目2',
            workflowType: 'planning',
            mode: 'normal',
            includeCodegen: false,
            includeCodeReview: false,
          }),
        ]);
        if (result1.state.status !== 'completed' || result2.state.status !== 'completed') {
          throw new Error(`期望两个工作流都完成: ${result1.state.status}, ${result2.state.status}`);
        }
        return `两个工作流都完成: ${result1.state.status}, ${result2.state.status}`;
      } finally {
        await cleanupTempDir(dir1);
        await cleanupTempDir(dir2);
      }
    });
  }

  async runTest(name, testFn) {
    this.currentTest++;
    displayProgress(this.currentTest, this.totalTests || '?', name);

    const start = Date.now();
    let result;

    try {
      const output = await runWithTimeout(testFn(), TEST_CONFIG.options.timeout);
      const duration = Date.now() - start;
      result = { name, ...formatResult(true, output, duration) };
      log(`${output} (${duration}ms)`, 'success');
    } catch (err) {
      const duration = Date.now() - start;
      result = { name, ...formatResult(false, err.message, duration) };
      log(`${err.message} (${duration}ms)`, 'error');
    }

    this.results.push(result);

    if (TEST_CONFIG.options.interactive) {
      await waitForUserInput();
    }
  }

  displayFinalReport() {
    const totalDuration = Date.now() - this.startTime;
    const report = generateReport(this.results);
    report.totalDuration = totalDuration;

    displayReport(report);

    const reportsDir = TEST_CONFIG.reportsDir;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFile = path.join(reportsDir, `test-report-${timestamp}.json`);

    fs.mkdir(reportsDir, { recursive: true })
      .then(() => fs.writeFile(reportFile, JSON.stringify(report, null, 2)))
      .then(() => console.log(`\n详细报告已保存: ${reportFile}`))
      .catch(() => console.log('\n无法保存报告文件'));
  }
}

const suite = new InteractiveTestSuite();
suite.totalTests = 28;

suite.run().catch((err) => {
  console.error(colorize(`\n测试套件错误: ${err.message}`, 'red'));
  process.exit(1);
});
