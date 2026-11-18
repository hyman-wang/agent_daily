'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../lib/core.js');

test('空白提问不会生成记录，摘要明确使用本地规则', function () {
  assert.equal(Core.createRecord({ question: '  \n ', timestamp: Date.now() }), null);
  const summary = Core.summarizeQuestion('如何设计一个可靠的本地优先扩展？\n请列出关键步骤。');
  assert.equal(summary.method, 'local-rules');
  assert.equal(summary.title, '如何设计一个可靠的本地优先扩展');
  assert.ok(summary.summary.includes('请列出关键步骤'));
  const record = Core.createRecord({ question: '测试问题', timestamp: 1736121600000, agent: 'chatgpt' });
  assert.equal(record.summaryMethod, 'local-rules');
});

test('日期键和周报范围使用本地时区，周一为一周开始', function () {
  const monday = new Date(2025, 0, 6, 8, 30);
  const sunday = new Date(2025, 0, 12, 23, 30);
  assert.equal(Core.localDateKey(monday), '2025-01-06');
  assert.deepEqual(Core.getWeekRange(monday).startKey, '2025-01-06');
  assert.deepEqual(Core.getWeekRange(monday).endKey, '2025-01-12');
  assert.equal(Core.getWeekRange(sunday).key, '2025-01-06');
  assert.equal(Core.currentPeriodKey('week', sunday), '2025-01-06');
  assert.equal(Core.shiftPeriod('day', '2025-01-01', -1), '2024-12-31');
  assert.equal(Core.shiftPeriod('week', '2025-01-06', 1), '2025-01-13');
});

test('日报和周报筛选、搜索、Agent 过滤与统计正确', function () {
  const records = [
    Core.createRecord({ question: '周一研究本地存储', timestamp: new Date(2025, 0, 6, 9).getTime(), agent: 'chatgpt' }),
    Core.createRecord({ question: '周二研究 CSS 布局', timestamp: new Date(2025, 0, 7, 9).getTime(), agent: 'claude' }),
    Core.createRecord({ question: '上周的问题', timestamp: new Date(2025, 0, 5, 9).getTime(), agent: 'gemini' })
  ];
  const week = Core.filterRecords(records, { view: 'week', period: '2025-01-06', agent: 'all', query: '' });
  const monday = Core.filterRecords(records, { view: 'day', period: '2025-01-06', agent: 'all', query: '' });
  const searched = Core.filterRecords(records, { view: 'week', period: '2025-01-06', agent: 'claude', query: '布局' });
  assert.equal(week.length, 2);
  assert.equal(monday.length, 1);
  assert.equal(searched.length, 1);
  assert.deepEqual(Core.calculateStats(week), { total: 2, activeDays: 2, agentCount: 2 });
  assert.equal(Core.groupRecords(week, 'week').length, 2);
});

test('URL 仅允许 HTTP(S)，并去除 query、hash 与凭据', function () {
  assert.equal(Core.sanitizeUrl('https://user:pass@example.com/chat?id=secret#answer'), 'https://example.com/chat');
  assert.equal(Core.sanitizeUrl('javascript:alert(1)'), '');
  assert.equal(Core.sanitizeUrl('file:///tmp/private'), '');
  assert.equal(Core.sanitizeUrl('not a url'), '');
});

test('导入校验拒绝错误文件、跳过无效记录并规范化字段', function () {
  const bad = Core.validateImport({ records: [] });
  assert.equal(bad.records.length, 0);
  assert.equal(bad.errors.length, 1);
  const result = Core.validateImport({
    app: 'agent-journal',
    version: 1,
    records: [
      { question: '有效问题', timestamp: 1736121600000, agent: 'unknown-agent', url: 'https://example.com/a?token=secret' },
      { question: '', timestamp: 1736121600000 },
      { question: '缺少时间' }
    ]
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.errors.length, 2);
  assert.equal(result.records[0].agent, 'generic');
  assert.equal(result.records[0].url, 'https://example.com/a');
});

test('合并导入按 ID 或内容指纹去重，且不改写已有记录', function () {
  const original = Core.createRecord({ question: '同一个问题', timestamp: 1736121600000, agent: 'kimi' });
  const duplicate = Core.createRecord({ question: '同一个问题', timestamp: 1736121600000, agent: 'kimi' });
  const next = Core.createRecord({ question: '另一个问题', timestamp: 1736121700000, agent: 'kimi' });
  const result = Core.mergeRecords([original], [duplicate, next]);
  assert.equal(result.added, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].id, next.id);
});

test('Markdown 转义 HTML 与标记，使用安全围栏保留提问原文', function () {
  const record = Core.createRecord({
    question: '<img src=x onerror=alert(1)>\n```js\nalert(1)\n```',
    timestamp: new Date(2025, 0, 6, 9).getTime(),
    agent: 'chatgpt',
    url: 'javascript:alert(1)',
    title: '[危险](https://evil.example) <b>标题</b>'
  });
  const markdown = Core.exportMarkdown([record], 'day', '2025-01-06');
  assert.ok(!markdown.includes('<img'));
  assert.ok(!markdown.includes('<b>'));
  assert.ok(!markdown.includes('javascript:'));
  assert.ok(markdown.includes('&lt;b&gt;'));
  assert.ok(markdown.includes('````text'));
  assert.ok(markdown.includes('本地规则提炼'));
});

test('设置归一化提供安全默认值并保留明确关闭的 Agent', function () {
  const defaults = Core.normalizeSettings();
  assert.equal(defaults.autoCapture, true);
  assert.equal(defaults.theme, 'system');
  assert.equal(defaults.agents.chatgpt, true);
  const custom = Core.normalizeSettings({ autoCapture: false, theme: 'invalid', agents: { kimi: false } });
  assert.equal(custom.autoCapture, false);
  assert.equal(custom.theme, 'system');
  assert.equal(custom.agents.kimi, false);
  assert.equal(custom.agents.claude, true);
});

test('站点识别限制在已知域名，避免相似恶意域名误判', function () {
  assert.equal(Core.detectAgent('chatgpt.com'), 'chatgpt');
  assert.equal(Core.detectAgent('foo.chatgpt.com'), 'chatgpt');
  assert.equal(Core.detectAgent('chatgpt.com.evil.example'), 'generic');
  assert.equal(Core.detectAgent('yuanbao.tencent.com'), 'yuanbao');
});
