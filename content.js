(function() {
  const DEBUG = true;

  function debugLog(...args) {
    if (DEBUG) console.log('[ZenChat]', ...args);
  }

  let container = null;
  let isHovered = false;
  let isFocused = false;
  let isNear = false;

  let config = {
    globalEnable: true,
    sensitivityModifier: 0,
    opacity: 5,
    siteChatgpt: true,
    siteClaude: true,
    siteDeepseek: true
  };

  debugLog('Script loaded.');

  chrome.storage.sync.get(config, (items) => {
    config = items;
    debugLog('Config loaded:', config);
    init();
  });

  chrome.storage.onChanged.addListener((changes) => {
    for (let key in changes) {
      if (changes.hasOwnProperty(key)) {
        config[key] = changes[key].newValue;
      }
    }
    debugLog('Config updated:', config);
    if (container) {
      container.style.setProperty('--zenchat-hidden-opacity', config.opacity / 100);
    }
    updateVisibility();
  });

  // ─── Site helpers ────────────────────────────────────────────────────────────

  function getHost() { return window.location.hostname; }
  function getPath() { return window.location.pathname; }

  function isSiteEnabled() {
    const h = getHost();
    if (h.includes('chatgpt.com') || h.includes('openai.com')) return config.siteChatgpt;
    if (h.includes('claude.ai'))    return config.siteClaude;
    if (h.includes('deepseek.com')) return config.siteDeepseek;
    return false;
  }

  function getSensitivity() {
    const h = getHost();
    let base = 100;
    if (h.includes('claude.ai'))    base = 150;
    if (h.includes('deepseek.com')) base = 185;
    return base + (parseInt(config.sensitivityModifier, 10) || 0);
  }

  // ─── isNewChat ───────────────────────────────────────────────────────────────
  // Returns true when there are no conversation messages on screen yet.

  function isNewChat() {
    const h = getHost();
    const p = getPath();

    // ChatGPT: landing page is exactly "/"
    if (h.includes('chatgpt.com') || h.includes('openai.com')) {
      if (p === '/' || p === '') return true;
      // DOM check: any conversation turn present?
      return document.querySelectorAll('[data-testid*="conversation-turn"]').length === 0;
    }

    // Claude: new-chat URLs
    if (h.includes('claude.ai')) {
      if (p === '/new' || p.startsWith('/chat/new') || p === '/chats') return true;
      return document.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"]').length === 0;
    }

    // DeepSeek: URL-only check — no DOM guessing.
    // New/landing chat pages use: /, /chat, or paths ending in /new
    // Active chat pages use:      /a/chat/s/<id> or similar unique paths
    if (h.includes('deepseek.com')) {
      const isLanding = p === '/' || p === '' || p === '/chat' || p.endsWith('/new');
      return isLanding;
    }

    return true;
  }

  // ─── findInputContainer ──────────────────────────────────────────────────────
  // Finds the element to slide. Must be the compact bottom input bar only.

  function findInputContainer() {
    const h = getHost();

    // ── ChatGPT ──────────────────────────────────────────────────────────────
    if (h.includes('chatgpt.com') || h.includes('openai.com')) {
      const textarea = document.getElementById('prompt-textarea');
      if (!textarea) return null;
      const form = textarea.closest('form');
      return form ? form.parentElement : null;
    }

    // ── Claude ───────────────────────────────────────────────────────────────
    if (h.includes('claude.ai')) {
      const editor = document.querySelector('div[contenteditable="true"]');
      if (!editor) return null;
      // Walk up looking for the input card, but cap at 6 levels to avoid grabbing page layout
      let el = editor;
      for (let i = 0; i < 6; i++) {
        if (!el.parentElement || el.parentElement.tagName === 'BODY') break;
        el = el.parentElement;
        // Stop at fieldset, form, or a div that is reasonably compact
        const tag = el.tagName;
        if (tag === 'FIELDSET' || tag === 'FORM') return el;
        if (tag === 'DIV' && el.offsetHeight < 300 && el.offsetWidth > 300) {
          // Check it doesn't span the full page height
          if (el.offsetHeight < window.innerHeight * 0.4) return el;
        }
      }
      return editor.parentElement || editor;
    }

    // ── DeepSeek ─────────────────────────────────────────────────────────────
    if (h.includes('deepseek.com')) {
      // If we're on a new-chat / landing page, do not attach anything
      if (isNewChat()) {
        debugLog('DeepSeek: new chat page, skipping container.');
        return null;
      }

      // On an active chat page: find the textarea and walk up to grab the
      // smallest reasonable ancestor that wraps the full input bar.
      const textarea = document.getElementById('chat-input') || document.querySelector('textarea');
      if (!textarea) {
        debugLog('DeepSeek: no textarea found.');
        return null;
      }

      // Walk up from textarea. Return the first ancestor that:
      //   1. Contains at least one <button> (the send button lives here)
      //   2. Is not taller than 40% of the viewport (not a full-page wrapper)
      let el = textarea.parentElement;
      for (let i = 0; i < 8; i++) {
        if (!el || ['BODY', 'HTML', 'MAIN'].includes(el.tagName)) break;
        const hasButton = el.querySelector('button') !== null;
        const notTooTall = el.offsetHeight < window.innerHeight * 0.4;
        if (hasButton && notTooTall) {
          debugLog('DeepSeek: container found at level', i, el.tagName, (el.className || '').substring(0, 60));
          return el;
        }
        el = el.parentElement;
      }

      // Last fallback: direct parent of textarea
      debugLog('DeepSeek: using textarea parent as fallback.');
      return textarea.parentElement || null;
    }

    return null;
  }

  // ─── Scroll button ────────────────────────────────────────────────────────────

  function findScrollButton() {
    const h = getHost();
    const allBtns = h.includes('chatgpt.com') || h.includes('openai.com')
      ? document.querySelectorAll('main button')
      : document.querySelectorAll('button');

    for (const btn of allBtns) {
      if (!btn.querySelector('svg')) continue;
      const r = btn.getBoundingClientRect();
      const nearBottom  = r.top > window.innerHeight - 300;
      const isSmall     = r.width > 20 && r.width < 70 && r.height > 20 && r.height < 70;
      const notLeftPane = r.left > window.innerWidth * 0.2;
      if (nearBottom && isSmall && notLeftPane) return btn;
    }
    return null;
  }

  // ─── Container lifecycle ──────────────────────────────────────────────────────

  function setupContainer(newContainer) {
    if (container === newContainer) return;

    if (container) {
      debugLog('Cleaning up container:', container.tagName);
      container.classList.remove('zenchat-input-container', 'zenchat-hidden', 'zenchat-visible');
      container.style.removeProperty('--zenchat-hidden-opacity');
      container.removeEventListener('mouseenter', onMouseEnter);
      container.removeEventListener('mouseleave', onMouseLeave);
      const sb = findScrollButton();
      if (sb) { sb.style.removeProperty('transform'); sb.style.removeProperty('transition'); }
    }

    container = newContainer;

    if (container) {
      debugLog('Setting up container:', container.tagName, container.offsetHeight + 'px');
      container.classList.add('zenchat-input-container');
      container.style.setProperty('--zenchat-hidden-opacity', config.opacity / 100);
      container.addEventListener('mouseenter', onMouseEnter);
      container.addEventListener('mouseleave', onMouseLeave);
      isFocused = container.contains(document.activeElement);
      updateVisibility();
    }
  }

  function onMouseEnter() { isHovered = true;  updateVisibility(); }
  function onMouseLeave() { isHovered = false; updateVisibility(); }

  // ─── Visibility ───────────────────────────────────────────────────────────────

  function updateVisibility() {
    if (!container) return;

    const active = config.globalEnable && isSiteEnabled();
    const isNew  = isNewChat();

    // When disabled or on new chat: always show, no effects
    if (!active || isNew) {
      container.classList.remove('zenchat-hidden');
      container.classList.add('zenchat-visible');
      const sb = findScrollButton();
      if (sb) { sb.style.removeProperty('transform'); sb.style.removeProperty('transition'); }
      return;
    }

    const shouldShow = isHovered || isFocused || isNear;
    debugLog(`Visibility: near=${isNear} focused=${isFocused} hovered=${isHovered} → show=${shouldShow}`);

    const sb = findScrollButton();

    if (shouldShow) {
      container.classList.remove('zenchat-hidden');
      container.classList.add('zenchat-visible');
      if (sb) { sb.style.removeProperty('transform'); sb.style.removeProperty('transition'); }
    } else {
      container.classList.remove('zenchat-visible');
      container.classList.add('zenchat-hidden');
      if (sb) {
        const shift = container.offsetHeight - 12;
        sb.style.setProperty('transform', `translateY(${shift}px)`, 'important');
        sb.style.setProperty('transition', 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)', 'important');
      }
    }
  }

  // ─── Proximity + hover check ──────────────────────────────────────────────────

  function checkProximity(clientX, clientY) {
    if (!config.globalEnable || !isSiteEnabled()) {
      if (isNear) { isNear = false; updateVisibility(); }
      return;
    }

    const sensitivity   = getSensitivity();
    const newNear       = (window.innerHeight - clientY) < sensitivity;
    let changed         = false;

    if (newNear !== isNear) { isNear = newNear; changed = true; }

    if (container) {
      const r = container.getBoundingClientRect();
      const inside = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
      if (inside !== isHovered) { isHovered = inside; changed = true; }
    }

    if (changed) updateVisibility();
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    document.addEventListener('mousemove',  (e) => checkProximity(e.clientX, e.clientY));
    document.addEventListener('mouseleave', ()  => { isNear = false; isHovered = false; updateVisibility(); });

    document.addEventListener('focusin', (e) => {
      if (container && container.contains(e.target)) { isFocused = true; updateVisibility(); }
    });

    document.addEventListener('focusout', (e) => {
      if (container && container.contains(e.target)) {
        setTimeout(() => {
          isFocused = !!(container && container.contains(document.activeElement));
          updateVisibility();
        }, 30);
      }
    });

    // Periodic scan: find container, tear down on new-chat pages
    setInterval(() => {
      if (isNewChat()) {
        if (container) {
          debugLog('New chat detected – tearing down container.');
          setupContainer(null);
        }
        return;
      }
      const found = findInputContainer();
      if (found !== container) setupContainer(found);
      else if (container) updateVisibility();
    }, 800);

    // Initial attach
    const found = findInputContainer();
    if (found) setupContainer(found);
  }

})();
