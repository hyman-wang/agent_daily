/* Dashboard rendering uses textContent for every persisted/user-provided string. */
(function initDashboard() {
  'use strict';
  const Core = window.AgentJournalCore;
  const Store = window.AgentJournalStorage;
  const state = {
    records: [],
    settings: Core.normalizeSettings(),
    view: 'day',
    period: Core.currentPeriodKey('day'),
    agent: 'all',
    query: ''
  };
  let toastTimer = 0;

  const byId = function byId(id) { return document.getElementById(id); };
  const elements = {
    periodTitle: byId('period-title'), periodSubtitle: byId('period-subtitle'),
    day: byId('view-day'), week: byId('view-week'), previous: byId('previous-period'),
    next: byId('next-period'), current: byId('current-period'), statsTotal: byId('stat-total'),
    statsDays: byId('stat-days'), statsAgents: byId('stat-agents'), statsDaysNote: byId('stat-days-note'),
    search: byId('search-input'), agentFilter: byId('agent-filter'), records: byId('records-container'),
    recordsCount: byId('records-count'), settingsDialog: byId('settings-dialog'),
    autoCapture: byId('auto-capture'), agentSettings: byId('agent-settings'), theme: byId('theme-select'),
    importFile: byId('import-file'), toast: byId('toast')
  };

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add('visible');
    toastTimer = window.setTimeout(function hide() { elements.toast.classList.remove('visible'); }, 3600);
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme;
  }

  function formatTime(timestamp, includeDate) {
    return new Intl.DateTimeFormat('zh-CN', includeDate ? {
      month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
    } : { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(timestamp));
  }

  function buildRecordCard(record) {
    const card = makeElement('article', 'question-card');
    const top = makeElement('div', 'question-top');
    const agentName = Core.AGENTS[record.agent] ? Core.AGENTS[record.agent].name : '其他 Agent';
    top.appendChild(makeElement('span', 'agent-badge', agentName));
    top.appendChild(makeElement('time', 'question-time', formatTime(record.timestamp, state.view === 'week')));
    if (record.sessionTitle) top.appendChild(makeElement('span', 'session-title', record.sessionTitle));
    card.appendChild(top);

    const deleteButton = makeElement('button', 'delete-record', '删除');
    deleteButton.type = 'button';
    deleteButton.setAttribute('aria-label', `删除记录：${record.title}`);
    deleteButton.addEventListener('click', async function removeRecord() {
      if (!window.confirm(`确定删除这条提问记录吗？\n\n${record.title}`)) return;
      state.records = state.records.filter(function keep(item) { return item.id !== record.id; });
      await Store.saveRecords(state.records);
      render();
      showToast('已删除这条记录');
    });
    card.appendChild(deleteButton);
    card.appendChild(makeElement('h3', '', record.title || '未命名问题'));
    card.appendChild(makeElement('p', 'question-summary', record.summary));

    const details = makeElement('details');
    details.appendChild(makeElement('summary', '', '查看提问原文'));
    details.appendChild(makeElement('pre', 'original-question', record.question));
    card.appendChild(details);
    if (record.url) {
      const link = makeElement('a', 'source-link', '打开原页面（已移除查询参数）');
      link.href = record.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      card.appendChild(link);
    }
    return card;
  }

  function renderRecords(periodRecords) {
    const visible = Core.filterRecords(periodRecords, {
      view: state.view, period: state.period, agent: state.agent, query: state.query
    });
    elements.recordsCount.textContent = state.query || state.agent !== 'all'
      ? `筛选出 ${visible.length} 条，共 ${periodRecords.length} 条` : `共 ${visible.length} 条，按时间倒序整理`;
    elements.records.replaceChildren();
    if (!visible.length) {
      const empty = makeElement('div', 'empty-state');
      empty.appendChild(makeElement('div', 'empty-symbol', 'AJ'));
      empty.appendChild(makeElement('h3', '', periodRecords.length ? '没有符合条件的记录' : '本期还没有提问记录'));
      empty.appendChild(makeElement('p', '', periodRecords.length
        ? '试试更换关键词或 Agent 筛选。' : '在支持的 Agent 网站发送一个问题后，记录会自动出现在这里。'));
      elements.records.appendChild(empty);
      return;
    }
    Core.groupRecords(visible, state.view).forEach(function appendGroup(group) {
      const section = makeElement('section', 'time-group');
      section.appendChild(makeElement('h3', 'group-label', state.view === 'week' ? group.key : group.label));
      group.records.forEach(function appendRecord(record) { section.appendChild(buildRecordCard(record)); });
      elements.records.appendChild(section);
    });
  }

  function render() {
    const isDay = state.view === 'day';
    const currentKey = Core.currentPeriodKey(state.view);
    elements.day.classList.toggle('active', isDay);
    elements.week.classList.toggle('active', !isDay);
    elements.day.setAttribute('aria-pressed', String(isDay));
    elements.week.setAttribute('aria-pressed', String(!isDay));
    elements.periodTitle.textContent = isDay
      ? (state.period === currentKey ? '今日提问日报' : '提问日报')
      : (state.period === currentKey ? '本周提问周报' : '提问周报');
    elements.periodSubtitle.textContent = Core.periodLabel(state.view, state.period);
    elements.next.disabled = state.period >= currentKey;
    elements.statsDaysNote.textContent = isDay ? '本自然日内' : '周一至周日';
    const periodRecords = Core.filterRecords(state.records, {
      view: state.view, period: state.period, agent: 'all', query: ''
    });
    const stats = Core.calculateStats(periodRecords);
    elements.statsTotal.textContent = String(stats.total);
    elements.statsDays.textContent = String(stats.activeDays);
    elements.statsAgents.textContent = String(stats.agentCount);
    renderRecords(periodRecords);
  }

  function switchView(view) {
    state.view = view;
    state.period = Core.currentPeriodKey(view);
    render();
  }

  function downloadFile(content, type, filename) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function revoke() { URL.revokeObjectURL(url); }, 1000);
  }

  async function persistSettings() {
    state.settings = await Store.saveSettings(state.settings);
    applyTheme();
  }

  function buildAgentControls() {
    Object.keys(Core.AGENTS).forEach(function eachAgent(key) {
      const name = Core.AGENTS[key].name;
      const option = makeElement('option', '', name);
      option.value = key;
      elements.agentFilter.appendChild(option);
      if (key === 'generic') return;
      const label = makeElement('label', 'agent-toggle');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.agent = key;
      checkbox.checked = state.settings.agents[key] !== false;
      checkbox.addEventListener('change', async function toggleAgent() {
        state.settings.agents[key] = checkbox.checked;
        await persistSettings();
        showToast(`${name}已${checkbox.checked ? '启用' : '停用'}自动记录`);
      });
      label.appendChild(checkbox);
      label.appendChild(makeElement('span', '', name));
      elements.agentSettings.appendChild(label);
    });
  }

  function bindEvents() {
    elements.day.addEventListener('click', function dayView() { switchView('day'); });
    elements.week.addEventListener('click', function weekView() { switchView('week'); });
    elements.previous.addEventListener('click', function previous() {
      state.period = Core.shiftPeriod(state.view, state.period, -1); render();
    });
    elements.next.addEventListener('click', function next() {
      state.period = Core.shiftPeriod(state.view, state.period, 1); render();
    });
    elements.current.addEventListener('click', function current() {
      state.period = Core.currentPeriodKey(state.view); render();
    });
    elements.search.addEventListener('input', function search() { state.query = elements.search.value; render(); });
    elements.agentFilter.addEventListener('change', function filter() { state.agent = elements.agentFilter.value; render(); });

    byId('export-markdown').addEventListener('click', function exportMarkdown() {
      const records = Core.filterRecords(state.records, { view: state.view, period: state.period, agent: 'all', query: '' });
      const markdown = Core.exportMarkdown(records, state.view, state.period);
      const label = state.view === 'day' ? '日报' : '周报';
      downloadFile(markdown, 'text/markdown;charset=utf-8', `Agent-${label}-${state.period}.md`);
      showToast('Markdown 已导出');
    });
    byId('export-json').addEventListener('click', function exportJson() {
      const content = JSON.stringify({
        app: Core.APP_ID, version: Core.DATA_VERSION, exportedAt: new Date().toISOString(),
        records: state.records, settings: state.settings
      }, null, 2);
      downloadFile(content, 'application/json;charset=utf-8', `agent-journal-backup-${Core.localDateKey()}.json`);
      showToast(`已备份 ${state.records.length} 条记录`);
    });
    byId('import-button').addEventListener('click', function chooseImport() { elements.importFile.click(); });
    elements.importFile.addEventListener('change', async function importJson() {
      const file = elements.importFile.files && elements.importFile.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const validated = Core.validateImport(data);
        if (!validated.records.length && validated.errors.length) {
          showToast(validated.errors[0]);
          return;
        }
        const merged = Core.mergeRecords(state.records, validated.records);
        state.records = merged.records;
        await Store.saveRecords(state.records);
        render();
        const skipped = validated.errors.length + merged.duplicates;
        showToast(`成功导入 ${merged.added} 条记录${skipped ? `，跳过 ${skipped} 条重复或无效记录` : ''}`);
      } catch (error) {
        showToast('导入失败：文件不是有效的 JSON。');
      } finally {
        elements.importFile.value = '';
      }
    });

    byId('open-settings').addEventListener('click', function openSettings() {
      elements.autoCapture.checked = state.settings.autoCapture;
      elements.theme.value = state.settings.theme;
      elements.agentSettings.querySelectorAll('input[data-agent]').forEach(function sync(checkbox) {
        checkbox.checked = state.settings.agents[checkbox.dataset.agent] !== false;
      });
      elements.settingsDialog.showModal();
    });
    byId('close-settings').addEventListener('click', function closeSettings() { elements.settingsDialog.close(); });
    elements.autoCapture.addEventListener('change', async function toggleCapture() {
      state.settings.autoCapture = elements.autoCapture.checked;
      await persistSettings();
      showToast(`自动记录已${state.settings.autoCapture ? '开启' : '关闭'}`);
    });
    elements.theme.addEventListener('change', async function changeTheme() {
      state.settings.theme = elements.theme.value;
      await persistSettings();
    });
    byId('clear-data').addEventListener('click', async function clearData() {
      if (!window.confirm('确定清空全部提问记录吗？此操作无法撤销，建议先备份全部数据。')) return;
      if (!window.confirm('请再次确认：所有日报和周报记录都将被永久删除。')) return;
      state.records = [];
      await Store.saveRecords([]);
      elements.settingsDialog.close();
      render();
      showToast('全部提问记录已清空，设置已保留');
    });
  }

  async function loadData() {
    const results = await Promise.all([Store.getRecords(), Store.getSettings()]);
    state.records = results[0];
    state.settings = results[1];
    applyTheme();
    buildAgentControls();
    bindEvents();
    render();
    chrome.storage.onChanged.addListener(function syncChanges(changes, areaName) {
      if (areaName !== 'local') return;
      if (changes.records) {
        state.records = Array.isArray(changes.records.newValue) ? changes.records.newValue : [];
        render();
      }
      if (changes.settings) {
        state.settings = Core.normalizeSettings(changes.settings.newValue);
        applyTheme();
      }
    });
  }

  loadData().catch(function onLoadError(error) {
    console.error('Agent Journal dashboard failed:', error);
    showToast('读取本地数据失败，请重新打开扩展页面。');
  });
})();
