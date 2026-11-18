/* Chrome storage boundary. All persistent data stays in chrome.storage.local. */
(function initStorage(root) {
  'use strict';
  const Core = root.AgentJournalCore;
  const KEYS = Object.freeze({ records: 'records', settings: 'settings' });
  let writeQueue = Promise.resolve();

  function getLocal(keys) {
    return new Promise(function promiseGet(resolve, reject) {
      chrome.storage.local.get(keys, function onGet(result) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result);
      });
    });
  }

  function setLocal(values) {
    return new Promise(function promiseSet(resolve, reject) {
      chrome.storage.local.set(values, function onSet() {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  async function getRecords() {
    const result = await getLocal([KEYS.records]);
    return Array.isArray(result.records) ? result.records : [];
  }

  function saveRecords(records) {
    const snapshot = Array.isArray(records) ? records : [];
    writeQueue = writeQueue.catch(function ignorePreviousError() {}).then(function write() {
      return setLocal({ records: snapshot });
    });
    return writeQueue;
  }

  async function getSettings() {
    const result = await getLocal([KEYS.settings]);
    return Core.normalizeSettings(result.settings);
  }

  async function saveSettings(settings) {
    const normalized = Core.normalizeSettings(settings);
    await setLocal({ settings: normalized });
    return normalized;
  }

  function addRecord(record) {
    writeQueue = writeQueue.catch(function ignorePreviousError() {}).then(async function append() {
      const current = await getRecords();
      const merged = Core.mergeRecords(current, [record]);
      if (merged.added) await setLocal({ records: merged.records });
      return { added: merged.added, duplicate: merged.duplicates };
    });
    return writeQueue;
  }

  root.AgentJournalStorage = {
    KEYS: KEYS,
    getRecords: getRecords,
    saveRecords: saveRecords,
    getSettings: getSettings,
    saveSettings: saveSettings,
    addRecord: addRecord
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
