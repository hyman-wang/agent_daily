/* Event-delegated capture survives SPA navigation and never blocks page events. */
(function initContentCapture() {
  'use strict';
  if (window.__agentJournalLoaded) return;
  window.__agentJournalLoaded = true;

  const Core = window.AgentJournalCore;
  const agent = Core.detectAgent(window.location.hostname);
  let settings = Core.normalizeSettings();
  let lastCapture = { text: '', timestamp: 0 };

  const SITE_SELECTORS = {
    chatgpt: {
      inputs: ['#prompt-textarea', 'textarea', '[contenteditable="true"]'],
      sends: ['[data-testid="send-button"]', 'button[aria-label*="Send" i]', 'button[aria-label*="发送"]']
    },
    claude: {
      inputs: ['div[contenteditable="true"]', 'textarea'],
      sends: ['button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button[type="submit"]']
    },
    gemini: {
      inputs: ['rich-textarea [contenteditable="true"]', '.ql-editor', 'textarea'],
      sends: ['button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button[mattooltip*="Send" i]']
    },
    deepseek: {
      inputs: ['textarea', '[contenteditable="true"]'],
      sends: ['button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button[type="submit"]']
    },
    kimi: {
      inputs: ['textarea', '[contenteditable="true"]'],
      sends: ['button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button[type="submit"]']
    },
    doubao: {
      inputs: ['textarea', '[contenteditable="true"]'],
      sends: ['button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button[type="submit"]']
    },
    yuanbao: {
      inputs: ['textarea', '[contenteditable="true"]'],
      sends: ['button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button[type="submit"]']
    },
    qianwen: {
      inputs: ['textarea', '[contenteditable="true"]'],
      sends: ['button[aria-label*="Send" i]', 'button[aria-label*="发送"]', 'button[type="submit"]']
    }
  };

  const adapter = SITE_SELECTORS[agent] || { inputs: [], sends: [] };
  const inputSelector = adapter.inputs.concat([
    'textarea', 'input[type="text"]', '[contenteditable="true"]', '[role="textbox"]'
  ]).join(',');
  const sendSelector = adapter.sends.concat([
    '[data-testid*="send" i]', '[aria-label*="send" i]', '[aria-label*="发送"]',
    'button[type="submit"]'
  ]).join(',');

  function isEditable(element) {
    return Boolean(element && element.closest && element.closest(inputSelector));
  }

  function getEditableFromEvent(event) {
    const direct = event.target && event.target.closest ? event.target.closest(inputSelector) : null;
    if (direct) return direct;
    const active = document.activeElement;
    return active && active.closest ? active.closest(inputSelector) : null;
  }

  function readQuestion(editable) {
    if (!editable) return '';
    if ('value' in editable && typeof editable.value === 'string') return Core.normalizeWhitespace(editable.value);
    return Core.normalizeWhitespace(editable.innerText || editable.textContent || '');
  }

  function captureFrom(editable) {
    if (!settings.autoCapture || settings.agents[agent] === false || !editable) return;
    const question = readQuestion(editable);
    if (!question || question.length > Core.MAX_QUESTION_LENGTH) return;
    const now = Date.now();
    if (question === lastCapture.text && now - lastCapture.timestamp < 2000) return;
    lastCapture = { text: question, timestamp: now };
    const record = {
      question: question,
      agent: agent,
      timestamp: now,
      url: window.location.href,
      sessionTitle: document.title
    };
    try {
      chrome.runtime.sendMessage({ type: 'agent-journal:capture', record: record }, function onCaptured() {
        void chrome.runtime.lastError;
      });
    } catch (error) {
      // The page must remain unaffected if the extension is reloaded or disabled.
    }
  }

  document.addEventListener('keydown', function onKeydown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229) return;
    if (!isEditable(event.target)) return;
    captureFrom(getEditableFromEvent(event));
  }, true);

  document.addEventListener('click', function onClick(event) {
    if (!event.target || !event.target.closest) return;
    const sendButton = event.target.closest(sendSelector);
    if (!sendButton) return;
    captureFrom(getEditableFromEvent(event));
  }, true);

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['settings'], function onSettings(result) {
      if (!chrome.runtime.lastError) settings = Core.normalizeSettings(result.settings);
    });
    chrome.storage.onChanged.addListener(function onChanged(changes, areaName) {
      if (areaName === 'local' && changes.settings) settings = Core.normalizeSettings(changes.settings.newValue);
    });
  }
})();
