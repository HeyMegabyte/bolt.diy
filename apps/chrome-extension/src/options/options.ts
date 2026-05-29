interface Settings {
  fabEnabled: boolean;
  autoOpenEnabled: boolean;
}

const DEFAULTS: Settings = { fabEnabled: true, autoOpenEnabled: true };

const fab = document.getElementById('fab-enabled') as HTMLInputElement;
const autoOpen = document.getElementById('autoopen-enabled') as HTMLInputElement;
const save = document.getElementById('save') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLParagraphElement;

async function load(): Promise<void> {
  const data = (await chrome.storage.sync.get(DEFAULTS)) as Settings;
  fab.checked = data.fabEnabled;
  autoOpen.checked = data.autoOpenEnabled;
}

save.addEventListener('click', async () => {
  await chrome.storage.sync.set({
    fabEnabled: fab.checked,
    autoOpenEnabled: autoOpen.checked,
  } satisfies Settings);
  status.textContent = 'Saved.';
  setTimeout(() => (status.textContent = ''), 1800);
});

void load();
