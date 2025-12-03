if (typeof browser === 'undefined') {
  var browser = chrome;
}

document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('adblockToggle');
  const status = document.getElementById('statusMessage');

  const { enabled = true } = await browser.storage.local.get('enabled');
  toggle.checked = !!enabled;
  status.textContent = enabled ? 'Активно' : 'Неактивно';

  toggle.addEventListener('change', async () => {
    const value = toggle.checked;
    await browser.storage.local.set({ enabled: value });
    status.textContent = value ? 'Активно' : 'Неактивно';
    try { await browser.runtime.sendMessage({ action: 'setEnabled', enabled: value }); } catch (e) {}
  });

  const startPickerBtn = document.getElementById('startPickerBtn');
  startPickerBtn.addEventListener('click', async () => {
    try { await browser.runtime.sendMessage({ action: 'startPicker' }); } catch (e) {}
    window.close();
  });
});
