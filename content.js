(function() {
  const DEBUG = true;

  function debugLog(...args) {
    if (DEBUG) {
      console.log('[ZenChat]', ...args);
    }
  }

  // Keep track of our container and event listeners state
  let container = null;
  let isHovered = false;
  let isFocused = false;
  let isNear = false;

  // Configuration default values
  let config = {
    globalEnable: true,
    sensitivityModifier: 0,
    opacity: 5,
    siteChatgpt: true,
    siteClaude: true,
    siteDeepseek: true
  };

  debugLog("Script loaded. Initializing...");

  // Load configuration and start
  chrome.storage.sync.get(config, (items) => {
    config = items;
    debugLog("Config loaded:", config);
    init();
  });

  // Listen for storage changes to update settings in real-time
  chrome.storage.onChanged.addListener((changes) => {
    for (let key in changes) {
      if (changes.hasOwnProperty(key)) {
        config[key] = changes[key].newValue;
      }
    }
    
    debugLog("Config updated:", config);

    // Update container styling if it exists
    if (container) {
      container.style.setProperty('--zenchat-hidden-opacity', config.opacity / 100);
    }
    
    updateVisibility();
  });

  // Determine if the extension is enabled for the current site
  function isSiteEnabled() {
    const host = window.location.hostname;
    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      return config.siteChatgpt;
    }
    if (host.includes('claude.ai')) {
      return config.siteClaude;
    }
    if (host.includes('deepseek.com')) {
      return config.siteDeepseek;
    }
    return false;
  }

  // Get site-specific base sensitivity + user modifier
  function getSensitivity() {
    const host = window.location.hostname;
    let baseSensitivity = 100; // Default (ChatGPT / Others)
    
    if (host.includes('claude.ai')) {
      baseSensitivity = 150;
    } else if (host.includes('deepseek.com')) {
      baseSensitivity = 185; // DeepSeek default set to 185px (175 + 10)
    }

    const modifier = parseInt(config.sensitivityModifier, 10) || 0;
    const finalSensitivity = baseSensitivity + modifier;
    
    return finalSensitivity;
  }

  // Check if this is a new chat (no messages visible)
  function isNewChat() {
    const host = window.location.hostname;
    const path = window.location.pathname;
    
    // 1. URL Path Check (instant and accurate)
    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      if (path === '/' || path === '') return true;
    } else if (host.includes('claude.ai')) {
      if (path === '/new' || path.startsWith('/chat/new') || path === '/chats') return true;
    } else if (host.includes('deepseek.com')) {
      // DeepSeek uses various URL patterns for new/landing chats
      if (path === '/' || path === '' || path === '/chat' || path.endsWith('/new') || path.includes('/chat/s/new')) return true;
    }

    // 2. DOM Check Fallback (if URL hasn't changed or has custom params)
    let messages = [];
    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      messages = document.querySelectorAll('main [data-testid*="conversation-turn"]');
    } else if (host.includes('claude.ai')) {
      messages = document.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"], div.font-claude-message');
    } else if (host.includes('deepseek.com')) {
      // DeepSeek: Look for actual chat message bubbles in the main content area
      // Use multiple specific selectors, then validate they're visible in the main area
      const candidates = document.querySelectorAll('.ds-message, [class*="message-chat"], [class*="msg-content"], [class*="chat-message"], div[class*="markdown"]');
      messages = Array.from(candidates).filter(msg => {
        // Exclude elements inside sidebar/navigation/history/welcome areas
        if (msg.closest('aside, nav, [class*="sidebar"], [class*="menu"], [class*="history"], [class*="welcome"], [class*="placeholder"]')) return false;
        // Must be visible and reasonably sized (actual message content)
        const rect = msg.getBoundingClientRect();
        if (rect.width < 100 || rect.height < 20) return false;
        // Must be in the main content area (right side of page, not in left sidebar)
        if (rect.left < 200) return false;
        return true;
      });
    } else {
      messages = document.querySelectorAll('[data-testid*="message"], [class*="message"], [role="article"]');
    }

    return messages.length === 0;
  }

  // Find the chat input container based on the host
  function findInputContainer() {
    const host = window.location.hostname;
    
    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      const textarea = document.getElementById('prompt-textarea');
      if (textarea) {
        const form = textarea.closest('form');
        if (form) {
          // ChatGPT: Return parent of the form to translate both form and disclaimer
          return form.parentElement;
        }
      }
    } 
    
    if (host.includes('claude.ai')) {
      const editor = document.querySelector('div[contenteditable="true"]');
      if (editor) {
        // Claude: Restrict to input card wrapper boundaries. 
        // DO NOT climb layout ancestors to avoid grabbing top-left headers or sidebar toggles.
        const wrapper = editor.closest('fieldset') || 
                        editor.closest('form') || 
                        editor.closest('div.bg-background') || 
                        editor.closest('.flex.flex-col.gap-1\\.5');
        return wrapper || editor;
      }
    } 
    
    if (host.includes('deepseek.com')) {
      // Safety: if this is a new chat landing page, don't select any container
      if (isNewChat()) {
        debugLog('DeepSeek: new chat detected, skipping container selection');
        return null;
      }

      const textarea = document.getElementById('chat-input') || document.querySelector('textarea');
      if (textarea) {
        // Viewport safety: never select an element taller than 50% of the viewport
        const maxHeight = window.innerHeight * 0.5;

        const form = textarea.closest('form');
        if (form) {
          const candidate = form.parentElement;
          if (candidate && candidate.offsetHeight < maxHeight) {
            // Verify this element is at the BOTTOM of the viewport (input bar position)
            const rect = candidate.getBoundingClientRect();
            if (rect.top > window.innerHeight * 0.5) {
              return candidate;
            }
          }
          // If parent is too large or not at bottom, use the form itself
          if (form.offsetHeight < maxHeight) {
            const formRect = form.getBoundingClientRect();
            if (formRect.top > window.innerHeight * 0.5) {
              return form;
            }
          }
        }
        // Fallback: only return elements anchored to the bottom of the page
        let current = textarea.parentElement;
        for (let i = 0; i < 5; i++) {
          if (!current || ['BODY', 'HTML', 'MAIN'].includes(current.tagName)) break;
          if (current.offsetHeight > maxHeight) {
            current = current.parentElement;
            continue;
          }
          const rect = current.getBoundingClientRect();
          // Must be in the bottom 40% of the viewport to be considered an input bar
          if (rect.top < window.innerHeight * 0.6) {
            current = current.parentElement;
            continue;
          }
          return current;
        }
        // Last resort: textarea's direct parent if at bottom and small
        if (textarea.parentElement && textarea.parentElement.offsetHeight < maxHeight) {
          const pRect = textarea.parentElement.getBoundingClientRect();
          if (pRect.top > window.innerHeight * 0.5) {
            return textarea.parentElement;
          }
        }
        debugLog('DeepSeek: textarea found but no suitable bottom-anchored container');
        return null;
      }
      return null;
    }

    // Fallback: return form.parentElement if small, otherwise the element itself
    const textareas = document.querySelectorAll('textarea, [contenteditable="true"]');
    for (const el of textareas) {
      if (el.offsetWidth > 100 && el.offsetHeight > 20 && el.offsetParent !== null) {
        const form = el.closest('form') || el.closest('fieldset');
        if (form && form.parentElement && form.parentElement.tagName !== 'BODY') {
          return form.parentElement;
        }
        return el.parentElement || el;
      }
    }

    return null;
  }

  // Validate if a button is indeed the scroll-to-bottom circular button
  function isValidScrollButton(btn) {
    if (!btn) return false;
    const rect = btn.getBoundingClientRect();
    
    // Constraints:
    // 1. Must be near the bottom of the screen (bottom 300px viewport quadrant)
    const isNearBottom = rect.bottom > window.innerHeight - 300 && rect.top > window.innerHeight - 340;
    // 2. Must be relatively small (typical circular scroll button size)
    const isSmall = rect.width > 20 && rect.width < 60 && rect.height > 20 && rect.height < 60;
    // 3. Must be aligned right or center (not in the left-side panel region)
    const isOnRightOrCenter = rect.left > window.innerWidth * 0.25;
    
    return isNearBottom && isSmall && isOnRightOrCenter;
  }

  // Find the scroll-to-bottom page down button
  function findScrollButton() {
    const host = window.location.hostname;
    
    // 1. Specific search for ChatGPT / OpenAI
    if (host.includes('chatgpt.com') || host.includes('openai.com')) {
      const buttons = document.querySelectorAll('main button');
      for (const btn of buttons) {
        if (btn.querySelector('svg') && isValidScrollButton(btn)) {
          return btn;
        }
      }
    }
    
    // 2. Try generic selectors, filtered by bounding box validity
    const candidates = document.querySelectorAll('button[class*="scroll"], div[class*="scroll"] button, button[aria-label*="scroll"], button[class*="down"]');
    for (const btn of candidates) {
      if (isValidScrollButton(btn)) {
        return btn;
      }
    }

    // 3. Scan all circular buttons containing an SVG at the bottom-right/center
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      if (btn.querySelector('svg') && isValidScrollButton(btn)) {
        return btn;
      }
    }
    
    return null;
  }

  // Set up or tear down container classes and events
  function setupContainer(newContainer) {
    if (container === newContainer) return;

    // Clean up previous container
    if (container) {
      debugLog("Cleaning up old container:", container);
      container.classList.remove('zenchat-input-container', 'zenchat-hidden', 'zenchat-visible');
      container.style.removeProperty('--zenchat-hidden-opacity');
      
      // Remove listeners
      container.removeEventListener('mouseenter', onMouseEnter);
      container.removeEventListener('mouseleave', onMouseLeave);

      // Restore scroll button state
      const scrollBtn = findScrollButton();
      if (scrollBtn) {
        scrollBtn.style.removeProperty('transform');
        scrollBtn.style.removeProperty('transition');
      }
    }

    container = newContainer;

    if (container) {
      debugLog("Setting up container:", container, "Height:", container.offsetHeight);
      // Apply our main container class
      container.classList.add('zenchat-input-container');
      container.style.setProperty('--zenchat-hidden-opacity', config.opacity / 100);
      
      // Hover listeners
      container.addEventListener('mouseenter', onMouseEnter);
      container.addEventListener('mouseleave', onMouseLeave);

      // Check initial states
      const activeEl = document.activeElement;
      isFocused = container.contains(activeEl);
      
      updateVisibility();
    }
  }

  // Hover handlers
  function onMouseEnter() {
    isHovered = true;
    updateVisibility();
  }

  function onMouseLeave() {
    isHovered = false;
    updateVisibility();
  }

  // Main function to update visibility classes
  function updateVisibility() {
    if (!container) return;

    const active = config.globalEnable && isSiteEnabled();
    const isNew = isNewChat();

    if (!active) {
      // If disabled, keep input fully visible
      container.classList.remove('zenchat-hidden');
      container.classList.add('zenchat-visible');
      
      const scrollBtn = findScrollButton();
      if (scrollBtn) {
        scrollBtn.style.removeProperty('transform');
        scrollBtn.style.removeProperty('transition');
      }
      return;
    }

    // Always show on new chat
    if (isNew) {
      container.classList.remove('zenchat-hidden');
      container.classList.add('zenchat-visible');
      
      const scrollBtn = findScrollButton();
      if (scrollBtn) {
        scrollBtn.style.removeProperty('transform');
        scrollBtn.style.removeProperty('transition');
      }
      return;
    }

    const shouldShow = isHovered || isFocused || isNear;
    
    debugLog(`Visibility update. Near: ${isNear}, Focused: ${isFocused}, Hovered: ${isHovered} -> Should Show: ${shouldShow}`);

    const scrollBtn = findScrollButton();

    if (shouldShow) {
      container.classList.remove('zenchat-hidden');
      container.classList.add('zenchat-visible');
      
      if (scrollBtn) {
        scrollBtn.style.removeProperty('transform');
        scrollBtn.style.removeProperty('transition');
      }
    } else {
      container.classList.remove('zenchat-visible');
      container.classList.add('zenchat-hidden');
      
      if (scrollBtn) {
        // Shift it down dynamically by the height of the bottom bar container minus the 12px sliver
        // so it slides down in unison and hovers correctly at the bottom of the screen
        const containerHeight = container.offsetHeight;
        const shiftAmount = containerHeight - 12;
        scrollBtn.style.setProperty('transform', `translateY(${shiftAmount}px)`, 'important');
        scrollBtn.style.setProperty('transition', 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)', 'important');
      }
    }
  }

  // Check proximity based on mouse coordinates relative to container and screen bottom
  function checkProximity(clientX, clientY) {
    if (!config.globalEnable || !isSiteEnabled()) {
      if (isNear) {
        isNear = false;
        updateVisibility();
      }
      return;
    }

    const distanceToBottom = window.innerHeight - clientY;
    const sensitivity = getSensitivity();
    const newNear = distanceToBottom < sensitivity;

    let stateChanged = false;
    
    if (newNear !== isNear) {
      isNear = newNear;
      stateChanged = true;
    }

    // Direct mathematical hover check (robust fallback for CSS transitions/animations)
    if (container) {
      const rect = container.getBoundingClientRect();
      const isMouseInside = clientX >= rect.left && 
                            clientX <= rect.right && 
                            clientY >= rect.top && 
                            clientY <= rect.bottom;
                            
      if (isMouseInside !== isHovered) {
        isHovered = isMouseInside;
        stateChanged = true;
      }
    }

    if (stateChanged) {
      updateVisibility();
    }
  }

  // Initialize event listeners
  function init() {
    // 1. Mouse Move Proximity and Coordinate Hover Detection
    document.addEventListener('mousemove', (e) => {
      checkProximity(e.clientX, e.clientY);
    });

    document.addEventListener('mouseleave', () => {
      isNear = false;
      isHovered = false;
      updateVisibility();
    });

    // 2. Focus Monitoring
    document.addEventListener('focusin', (e) => {
      if (container && container.contains(e.target)) {
        isFocused = true;
        updateVisibility();
      }
    });

    document.addEventListener('focusout', (e) => {
      if (container && container.contains(e.target)) {
        // Slight timeout in case focus moves between child elements
        setTimeout(() => {
          const activeEl = document.activeElement;
          isFocused = container && container.contains(activeEl);
          updateVisibility();
        }, 30);
      }
    });

    // 3. Periodic container search (handles SPA navigation/DOM updates)
    setInterval(() => {
      // If on a new chat page, tear down any container so the page is untouched
      if (isNewChat() && container) {
        debugLog('New chat detected, tearing down container');
        setupContainer(null);
        return;
      }

      const current = findInputContainer();
      if (current !== container) {
        setupContainer(current);
      }
      // Also re-check visibility in case URL changed (SPA navigation)
      if (container) {
        updateVisibility();
      }
    }, 800);

    // Initial search
    const current = findInputContainer();
    if (current) setupContainer(current);
  }
})();
