'use strict';

importScripts('lib/core.js', 'lib/storage.js');

chrome.action.onClicked.addListener(function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
});

chrome.runtime.onMessage.addListener(function handleMessage(message, sender, sendResponse) {
  if (!message || message.type !== 'agent-journal:capture') return false;
  (async function capture() {
    const settings = await AgentJournalStorage.getSettings();
    const record = AgentJournalCore.createRecord(message.record || {});
    if (!record) return { ok: false, reason: 'invalid-record' };
    if (!settings.autoCapture || settings.agents[record.agent] === false) {
      return { ok: true, added: 0, disabled: true };
    }
    const result = await AgentJournalStorage.addRecord(record);
    return { ok: true, added: result.added, duplicate: result.duplicate };
  })().then(sendResponse).catch(function onError(error) {
    console.error('Agent Journal capture failed:', error);
    sendResponse({ ok: false, reason: 'storage-error' });
  });
  return true;
});
