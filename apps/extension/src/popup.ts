/**
 * The popup: the user gesture that starts everything.
 *
 * Filling is deliberately never automatic. `activeTab` only grants access to a
 * page when the person invokes the extension on it, and that is the design
 * rather than a limitation: the product's whole claim is that a human approved
 * this packet and is watching this page.
 *
 * Every string rendered here that came from the API — a job title, a company,
 * a URL — is set with `textContent`, never parsed as HTML. Those strings
 * started life on an employer's page, and an extension page is a privileged
 * place for someone else's markup to run.
 */
import type { AwaitingSubmission, FillTarget } from '@job-getter/contracts';
import {
  checkConfirmation,
  ensureApiPermission,
  fillActiveTab,
  forgetPairing,
  loadTargets,
  pairWithCode,
} from './background.js';
import { originOf } from './session.js';
import { arrangeTargets, checkableHere, normaliseBaseUrl, openableUrl } from './targets.js';

declare const chrome: {
  tabs: {
    query(info: {
      active: boolean;
      currentWindow: boolean;
    }): Promise<{ id?: number; url?: string }[]>;
    create(properties: { url: string }): Promise<unknown>;
  };
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

function clearStatus(): void {
  element<HTMLDivElement>('status').hidden = true;
}

/**
 * The tab this popup was opened over, resolved as it renders.
 *
 * Deliberately not re-read at click time: see `FillOptions.tabId`.
 */
let targetTabId: number | undefined;
let targetTabOrigin: string | null = null;
let busy = false;

function targetRow(target: FillTarget, action: 'fill' | 'open'): HTMLLIElement {
  const row = document.createElement('li');

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = target.job.title;
  const company = document.createElement('div');
  company.textContent = target.job.company;
  const where = document.createElement('div');
  where.className = 'meta';
  where.textContent = target.destination.origin;
  row.append(title, company, where);

  const button = document.createElement('button');
  button.type = 'button';
  if (action === 'fill') {
    button.textContent = 'Fill this page';
    button.addEventListener('click', () => void fill(target));
  } else {
    const url = openableUrl(target);
    button.className = 'secondary';
    button.textContent = 'Open the application page';
    button.disabled = url === null;
    button.addEventListener('click', () => {
      // A new tab, not this one: the person may be in the middle of something.
      if (url !== null) void chrome.tabs.create({ url });
    });
  }
  row.append(button);
  return row;
}

function awaitingRow(item: AwaitingSubmission): HTMLLIElement {
  const row = document.createElement('li');
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = item.job.title;
  const company = document.createElement('div');
  company.textContent = item.job.company;
  row.append(title, company);

  if (checkableHere(item, targetTabOrigin)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'I submitted it: check this page';
    button.addEventListener('click', () => void check(item));
    row.append(button);
  } else {
    const where = document.createElement('div');
    where.className = 'meta';
    where.textContent = `Check it from the page ${item.destination.origin} shows after you submit.`;
    row.append(where);
  }
  return row;
}

function renderList(listId: string, emptyId: string, rows: readonly HTMLLIElement[]): void {
  element<HTMLUListElement>(listId).replaceChildren(...rows);
  element<HTMLParagraphElement>(emptyId).hidden = rows.length > 0;
}

async function render(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  targetTabId = tab?.id;
  targetTabOrigin = tab?.url === undefined ? null : originOf(tab.url);

  const result = await loadTargets();
  const paired = result.kind !== 'unpaired';
  element<HTMLFormElement>('pairing').hidden = paired;
  element<HTMLDivElement>('fill').hidden = !paired;

  if (result.kind === 'unpaired') {
    if (result.message !== null) show(result.message);
    return;
  }

  element<HTMLParagraphElement>('paired-with').textContent = `Paired with ${result.baseUrl}`;
  if (result.kind === 'error') {
    renderList('here', 'here-empty', []);
    renderList('elsewhere', 'elsewhere-empty', []);
    renderList('awaiting', 'awaiting-empty', []);
    show(result.message);
    return;
  }

  const { here, elsewhere } = arrangeTargets(result.items, targetTabOrigin);
  renderList(
    'here',
    'here-empty',
    here.map((target) => targetRow(target, 'fill')),
  );
  renderList(
    'elsewhere',
    'elsewhere-empty',
    elsewhere.map((target) => targetRow(target, 'open')),
  );
  renderList('awaiting', 'awaiting-empty', result.awaiting.map(awaitingRow));
}

async function check(item: AwaitingSubmission): Promise<void> {
  if (busy) return;
  busy = true;
  show('Reading the page…');
  try {
    const result = await checkConfirmation(item, { tabId: targetTabId });
    // Recorded either way, so the application has left the waiting list.
    await render();
    show(result.message);
  } finally {
    busy = false;
  }
}

async function fill(target: FillTarget): Promise<void> {
  if (busy) return;
  busy = true;
  show('Working…');
  try {
    const result = await fillActiveTab(target.application_id, target.content_hash, {
      tabId: targetTabId,
    });
    // The application has left `approved` (or come back to it), so the list
    // is re-read rather than trusted.
    await render();
    show(result.message);
  } finally {
    busy = false;
  }
}

element<HTMLFormElement>('pairing').addEventListener('submit', async (event) => {
  event.preventDefault();
  const baseUrl = normaliseBaseUrl(element<HTMLInputElement>('base-url').value);
  const codeInput = element<HTMLInputElement>('code');
  if (baseUrl === null) {
    show('That is not an http or https address.');
    return;
  }
  // Without this the API's response is unreadable: it sends no CORS headers,
  // by design, and only a host permission exempts the extension from that.
  // It must be asked for here, on the person's own click.
  if (!(await ensureApiPermission(baseUrl))) {
    show('Without permission to reach your installation, nothing can be filled.');
    return;
  }
  show('Pairing…');
  const result = await pairWithCode(baseUrl, codeInput.value);
  // Cleared either way: the code is single-use, and a secret left in a DOM
  // input is a secret in a DOM.
  codeInput.value = '';
  if (!result.ok) {
    show(result.message);
    return;
  }
  clearStatus();
  await render();
});

element<HTMLButtonElement>('unpair').addEventListener('click', async () => {
  await forgetPairing();
  await render();
  // Forgetting is local. The token is still valid until it is revoked, and
  // only the web app can do that.
  show('Forgotten here. Revoke it in Settings → Devices too, so the token stops working.');
});

void render();
