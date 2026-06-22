document.addEventListener('DOMContentLoaded', () => {
  const globalEnable = document.getElementById('global-enable');
  const sensitivityModifier = document.getElementById('sensitivity-modifier');
  const opacity = document.getElementById('opacity');
  const siteChatgpt = document.getElementById('site-chatgpt');
  const siteClaude = document.getElementById('site-claude');
  const siteDeepseek = document.getElementById('site-deepseek');

  const valSensitivity = document.getElementById('val-sensitivity');
  const valOpacity = document.getElementById('val-opacity');

  const advancedToggle = document.getElementById('advanced-toggle');
  const advancedPanel = document.getElementById('advanced-panel');
  const advancedChevron = document.getElementById('advanced-chevron');

  // Default values
  const defaults = {
    globalEnable: true,
    sensitivityModifier: 0,
    opacity: 5,
    siteChatgpt: true,
    siteClaude: true,
    siteDeepseek: true
  };

  // Load saved settings
  chrome.storage.sync.get(defaults, (items) => {
    globalEnable.checked = items.globalEnable;
    sensitivityModifier.value = items.sensitivityModifier;
    opacity.value = items.opacity;
    siteChatgpt.checked = items.siteChatgpt;
    siteClaude.checked = items.siteClaude;
    siteDeepseek.checked = items.siteDeepseek;

    // Update displays
    updateSensitivityDisplay(items.sensitivityModifier);
    valOpacity.textContent = `${items.opacity}%`;
  });

  // Load advanced panel toggle state from local storage (so it remembers open/close)
  chrome.storage.local.get({ advancedOpen: false }, (res) => {
    if (res.advancedOpen) {
      advancedPanel.classList.remove('hidden');
      advancedChevron.textContent = '▼';
    } else {
      advancedPanel.classList.add('hidden');
      advancedChevron.textContent = '▶';
    }
  });

  // Toggle Advanced Settings
  advancedToggle.addEventListener('click', () => {
    const isHidden = advancedPanel.classList.toggle('hidden');
    advancedChevron.textContent = isHidden ? '▶' : '▼';
    chrome.storage.local.set({ advancedOpen: !isHidden });
  });

  // Save settings on changes
  function saveSetting(key, value) {
    chrome.storage.sync.set({ [key]: value });
  }

  function updateSensitivityDisplay(value) {
    const val = parseInt(value, 10);
    valSensitivity.textContent = val >= 0 ? `+${val}px` : `${val}px`;
  }

  globalEnable.addEventListener('change', () => {
    saveSetting('globalEnable', globalEnable.checked);
  });

  sensitivityModifier.addEventListener('input', () => {
    updateSensitivityDisplay(sensitivityModifier.value);
    saveSetting('sensitivityModifier', parseInt(sensitivityModifier.value, 10));
  });

  opacity.addEventListener('input', () => {
    valOpacity.textContent = `${opacity.value}%`;
    saveSetting('opacity', parseInt(opacity.value, 10));
  });

  siteChatgpt.addEventListener('change', () => {
    saveSetting('siteChatgpt', siteChatgpt.checked);
  });

  siteClaude.addEventListener('change', () => {
    saveSetting('siteClaude', siteClaude.checked);
  });

  siteDeepseek.addEventListener('change', () => {
    saveSetting('siteDeepseek', siteDeepseek.checked);
  });
});
