/* Agent Journal pure domain logic. No DOM or Chrome API dependencies. */
(function initAgentJournalCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.AgentJournalCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createCore() {
  'use strict';

  const APP_ID = 'agent-journal';
  const DATA_VERSION = 1;
  const MAX_QUESTION_LENGTH = 100000;

  const AGENTS = Object.freeze({
    chatgpt: { name: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
    claude: { name: 'Claude', hosts: ['claude.ai'] },
    gemini: { name: 'Gemini', hosts: ['gemini.google.com'] },
    deepseek: { name: 'DeepSeek', hosts: ['chat.deepseek.com'] },
    kimi: { name: 'Kimi', hosts: ['www.kimi.com', 'kimi.moonshot.cn'] },
    doubao: { name: '豆包', hosts: ['www.doubao.com'] },
    yuanbao: { name: '腾讯元宝', hosts: ['yuanbao.tencent.com'] },
    qianwen: { name: '通义', hosts: ['www.tongyi.com', 'tongyi.aliyun.com'] },
    generic: { name: '其他 Agent', hosts: [] }
  });

  const DEFAULT_SETTINGS = Object.freeze({
    autoCapture: true,
    theme: 'system',
    agents: Object.freeze(Object.keys(AGENTS).reduce(function defaults(result, key) {
      result[key] = true;
      return result;
    }, {}))
  });

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function asValidDate(input) {
    const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function localDateKey(input) {
    const date = asValidDate(input === undefined ? Date.now() : input);
    if (!date) return '';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function dateFromKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(year, month, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
    return date;
  }

  function getWeekRange(input) {
    const original = asValidDate(input === undefined ? Date.now() : input);
    if (!original) return null;
    const date = new Date(original.getFullYear(), original.getMonth(), original.getDate(), 12);
    const daysSinceMonday = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - daysSinceMonday);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
    return {
      key: localDateKey(start),
      start: start,
      end: end,
      startKey: localDateKey(start),
      endKey: localDateKey(end)
    };
  }

  function getPeriodRange(view, key) {
    if (view === 'week') {
      const range = getWeekRange(dateFromKey(key) || key);
      return range && range.key === key ? range : getWeekRange(key);
    }
    const date = dateFromKey(key);
    if (!date) return null;
    return {
      key: key,
      start: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0),
      end: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999),
      startKey: key,
      endKey: key
    };
  }

  function currentPeriodKey(view, input) {
    return view === 'week' ? getWeekRange(input).key : localDateKey(input);
  }

  function shiftPeriod(view, key, offset) {
    const date = dateFromKey(key);
    if (!date || !Number.isFinite(offset)) return currentPeriodKey(view);
    date.setDate(date.getDate() + Math.trunc(offset) * (view === 'week' ? 7 : 1));
    return currentPeriodKey(view, date);
  }

  function periodLabel(view, key) {
    const range = getPeriodRange(view, key);
    if (!range) return '';
    if (view === 'day') return key;
    return `${range.startKey} 至 ${range.endKey}`;
  }

  function normalizeWhitespace(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/[\t\f\v ]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function truncateAtBoundary(text, limit) {
    if (text.length <= limit) return text;
    const slice = text.slice(0, limit);
    const boundary = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('，'), slice.lastIndexOf('。'));
    const end = boundary >= Math.floor(limit * 0.6) ? boundary : limit;
    return `${slice.slice(0, end).trim()}…`;
  }

  function summarizeQuestion(value) {
    const question = normalizeWhitespace(value);
    if (!question) return { title: '', summary: '', method: 'local-rules' };
    const firstLine = question.split('\n')[0];
    const firstSentence = firstLine.split(/(?<=[。！？!?])/)[0].trim();
    const titleSource = firstSentence || firstLine;
    return {
      title: truncateAtBoundary(titleSource.replace(/[。！？!?]+$/u, ''), 42),
      summary: truncateAtBoundary(question.replace(/\n/g, ' '), 140),
      method: 'local-rules'
    };
  }

  function sanitizeUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch (error) {
      return '';
    }
  }

  function hashText(value) {
    let first = 2166136261;
    let second = 2246822519;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 3266489917);
    }
    return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
  }

  function recordFingerprint(record) {
    return hashText([
      record.agent || 'generic',
      Number(record.timestamp) || 0,
      normalizeWhitespace(record.question),
      sanitizeUrl(record.url)
    ].join('\u001f'));
  }

  function createRecord(input) {
    const question = normalizeWhitespace(input && input.question).slice(0, MAX_QUESTION_LENGTH);
    if (!question) return null;
    const timestamp = Number(input.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
    const agent = Object.prototype.hasOwnProperty.call(AGENTS, input.agent) ? input.agent : 'generic';
    const summary = summarizeQuestion(question);
    const record = {
      id: '',
      question: question,
      title: normalizeWhitespace(input.title || summary.title).slice(0, 120),
      summary: normalizeWhitespace(input.summary || summary.summary).slice(0, 300),
      summaryMethod: 'local-rules',
      agent: agent,
      timestamp: Math.trunc(timestamp),
      url: sanitizeUrl(input.url),
      sessionTitle: normalizeWhitespace(input.sessionTitle).slice(0, 200)
    };
    record.id = `q_${Math.trunc(timestamp).toString(36)}_${recordFingerprint(record)}`;
    return record;
  }

  function normalizeSettings(input) {
    const source = input && typeof input === 'object' ? input : {};
    const agents = {};
    Object.keys(AGENTS).forEach(function eachAgent(key) {
      agents[key] = !source.agents || source.agents[key] !== false;
    });
    return {
      autoCapture: source.autoCapture !== false,
      theme: ['system', 'light', 'dark'].includes(source.theme) ? source.theme : 'system',
      agents: agents
    };
  }

  function validateImport(data) {
    const errors = [];
    if (!data || typeof data !== 'object' || data.app !== APP_ID || !Array.isArray(data.records)) {
      return { records: [], errors: ['文件格式不正确：需要 Agent Journal JSON 导出文件。'] };
    }
    const records = [];
    data.records.forEach(function eachRecord(raw, index) {
      if (!raw || typeof raw !== 'object' || typeof raw.question !== 'string' ||
          !normalizeWhitespace(raw.question) || raw.question.length > MAX_QUESTION_LENGTH ||
          !Number.isFinite(Number(raw.timestamp)) || Number(raw.timestamp) <= 0) {
        errors.push(`第 ${index + 1} 条记录无效，已跳过。`);
        return;
      }
      const record = createRecord(raw);
      if (record) records.push(record);
      else errors.push(`第 ${index + 1} 条记录无效，已跳过。`);
    });
    return { records: records, errors: errors };
  }

  function mergeRecords(existing, incoming) {
    const records = Array.isArray(existing) ? existing.slice() : [];
    const ids = new Set(records.map(function getId(record) { return record.id; }));
    const fingerprints = new Set(records.map(recordFingerprint));
    let added = 0;
    let duplicates = 0;
    (Array.isArray(incoming) ? incoming : []).forEach(function merge(record) {
      const fingerprint = recordFingerprint(record);
      if (ids.has(record.id) || fingerprints.has(fingerprint)) {
        duplicates += 1;
        return;
      }
      records.push(record);
      ids.add(record.id);
      fingerprints.add(fingerprint);
      added += 1;
    });
    records.sort(function newestFirst(a, b) { return b.timestamp - a.timestamp; });
    return { records: records, added: added, duplicates: duplicates };
  }

  function filterRecords(records, options) {
    const settings = options || {};
    const view = settings.view === 'week' ? 'week' : 'day';
    const range = getPeriodRange(view, settings.period || currentPeriodKey(view));
    const query = normalizeWhitespace(settings.query).toLocaleLowerCase();
    const agent = settings.agent || 'all';
    if (!range) return [];
    return (Array.isArray(records) ? records : []).filter(function matches(record) {
      if (record.timestamp < range.start.getTime() || record.timestamp > range.end.getTime()) return false;
      if (agent !== 'all' && record.agent !== agent) return false;
      if (!query) return true;
      const haystack = [record.question, record.title, record.summary, record.sessionTitle,
        AGENTS[record.agent] ? AGENTS[record.agent].name : record.agent].join('\n').toLocaleLowerCase();
      return haystack.includes(query);
    }).sort(function newestFirst(a, b) { return b.timestamp - a.timestamp; });
  }

  function calculateStats(records) {
    const days = new Set();
    const agents = new Set();
    (Array.isArray(records) ? records : []).forEach(function count(record) {
      days.add(localDateKey(record.timestamp));
      agents.add(record.agent);
    });
    return { total: Array.isArray(records) ? records.length : 0, activeDays: days.size, agentCount: agents.size };
  }

  function groupRecords(records, view) {
    const groups = new Map();
    (Array.isArray(records) ? records : []).forEach(function group(record) {
      const date = new Date(record.timestamp);
      const key = view === 'week' ? localDateKey(date) : `${localDateKey(date)} ${pad(date.getHours())}:00`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    });
    return Array.from(groups.entries()).map(function makeGroup(entry) {
      return { key: entry[0], label: entry[0], records: entry[1].sort(function newest(a, b) { return b.timestamp - a.timestamp; }) };
    }).sort(function newestGroup(a, b) { return b.key.localeCompare(a.key); });
  }

  function safeMarkdownText(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\\/g, '\\\\').replace(/([`*_[\]#|])/g, '\\$1')
      .replace(/\r/g, '').trim();
  }

  function fencedText(value) {
    const text = String(value || '')
      .replace(/\r/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const runs = text.match(/`+/g) || [];
    const longest = runs.reduce(function max(length, run) { return Math.max(length, run.length); }, 0);
    const fence = '`'.repeat(Math.max(3, longest + 1));
    return `${fence}text\n${text}\n${fence}`;
  }

  function exportMarkdown(records, view, key) {
    const list = Array.isArray(records) ? records : [];
    const range = getPeriodRange(view, key);
    const heading = view === 'week' ? `Agent 周报 · ${range.startKey} 至 ${range.endKey}` : `Agent 日报 · ${key}`;
    const stats = calculateStats(list);
    const lines = [`# ${heading}`, '', '> 由 Agent Journal 在本地生成；标题与摘要来自本地规则提炼，并非 AI 生成。',
      '', `共 ${stats.total} 个问题 · ${stats.activeDays} 个活跃日 · ${stats.agentCount} 个 Agent`, ''];
    if (!list.length) lines.push('本期暂无记录。');
    const groups = groupRecords(list, view);
    groups.forEach(function appendGroup(group) {
      if (view === 'week') lines.push(`## ${group.key}`, '');
      group.records.forEach(function appendRecord(record) {
        const date = new Date(record.timestamp);
        const agentName = AGENTS[record.agent] ? AGENTS[record.agent].name : record.agent;
        lines.push(`### ${safeMarkdownText(record.title || '未命名问题')}`, '');
        lines.push(`- 时间：${localDateKey(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`);
        lines.push(`- 来源：${safeMarkdownText(agentName)}`);
        if (record.sessionTitle) lines.push(`- 会话：${safeMarkdownText(record.sessionTitle)}`);
        if (record.url) lines.push(`- 页面：${safeMarkdownText(record.url)}`);
        lines.push(`- 摘要：${safeMarkdownText(record.summary)}`, '', '**提问原文**', '', fencedText(record.question), '');
      });
    });
    return lines.join('\n');
  }

  function detectAgent(hostname) {
    const host = String(hostname || '').toLowerCase();
    const found = Object.keys(AGENTS).find(function match(key) {
      return AGENTS[key].hosts.some(function hostMatch(candidate) {
        return host === candidate || host.endsWith(`.${candidate}`);
      });
    });
    return found || 'generic';
  }

  return {
    APP_ID: APP_ID,
    DATA_VERSION: DATA_VERSION,
    MAX_QUESTION_LENGTH: MAX_QUESTION_LENGTH,
    AGENTS: AGENTS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    localDateKey: localDateKey,
    getWeekRange: getWeekRange,
    getPeriodRange: getPeriodRange,
    currentPeriodKey: currentPeriodKey,
    shiftPeriod: shiftPeriod,
    periodLabel: periodLabel,
    normalizeWhitespace: normalizeWhitespace,
    summarizeQuestion: summarizeQuestion,
    sanitizeUrl: sanitizeUrl,
    createRecord: createRecord,
    recordFingerprint: recordFingerprint,
    normalizeSettings: normalizeSettings,
    validateImport: validateImport,
    mergeRecords: mergeRecords,
    filterRecords: filterRecords,
    calculateStats: calculateStats,
    groupRecords: groupRecords,
    safeMarkdownText: safeMarkdownText,
    exportMarkdown: exportMarkdown,
    detectAgent: detectAgent
  };
});
