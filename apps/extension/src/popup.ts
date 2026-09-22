/**
 * The popup: the user gesture that starts everything.
 *
 * Filling is deliberately never automatic. `activeTab` only grants access to a
 * page when the person invokes the extension on it, and that is the design
 * rather than a limitation: the product's whole claim is that a human approved
 * this packet and is watching this page.
 */
import { ensureApiPermission, fillActiveTab, readPairing, savePairing } from './background.js';

declare const chrome: {
  tabs: { query(info: { active: boolean; currentWindow: boolean }): Promise<{ id?: number }[]> };
};

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing element: ${id}`);
  return node as T;
}

function show(message: string): void {
  const status = element<HTMLDivElement>('status');
  status.hidden = false;
  status.textContent = message;
}

async function render(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  targetTabId = tab?.id;

  const pairing = await readPairing();
  element<HTMLDivElement>('pairing').hidden = pairing !== null;
  element<HTMLDivElement>('fill').hidden = pairing === null;
  if (pairing !== null) show(`Paired with ${pairing.baseUrl}.`);
}

element<HTMLButtonElement>('pair').addEventListener('click', async () => {
  const baseUrl = element<HTMLInputElement>('base-url').value.trim();
  const token = element<HTMLInputElement>('token').value.trim();
  if (baseUrl === '' || token === '') {
    show('Both the installation address and the token are needed.');
    return;
  }
  const normalised = baseUrl.replace(/\/+$/, '');
  // Without this the API's response is unreadable: it sends no CORS headers,
  // by design, and only a host permission exempts the extension from that.
  if (!(await ensureApiPermission(normalised))) {
    show('Without permission to reach your installation, nothing can be filled.');
    return;
  }
  await savePairing({ baseUrl: normalised, token });
  // Cleared immediately: a token left in a DOM input is a token in a DOM.
  element<HTMLInputElement>('token').value = '';
  await render();
});

/**
 * The tab this popup was opened over, resolved as it renders.
 *
 * Deliberately not re-read at click time: see `FillOptions.tabId`.
 */
let targetTabId: number | undefined;

element<HTMLButtonElement>('start').addEventListener('click', async () => {
  const applicationId = element<HTMLInputElement>('application').value.trim();
  const contentHash = element<HTMLInputElement>('hash').value.trim();
  if (applicationId === '' || contentHash === '') {
    show('Paste the application id and the packet hash from the review screen.');
    return;
  }
  show('Working…');
  const result = await fillActiveTab(applicationId, contentHash, { tabId: targetTabId });
  show(result.message);
});

void render();
