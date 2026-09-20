import { Button, Checkbox, Dialog, RadioGroup, TextArea, TextField } from '@job-getter/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createAnonymousApi, renderApp, renderWithProviders } from './helpers';

describe('form accessibility', () => {
  it('associates every field with its label', async () => {
    renderApp({ client: createAnonymousApi(), route: '/login' });

    const email = await screen.findByLabelText(/Email/);
    const password = screen.getByLabelText(/Password/);
    expect(email.tagName).toBe('INPUT');
    expect(password.getAttribute('type')).toBe('password');
  });

  it('announces validation errors and links them to the field', async () => {
    const user = userEvent.setup();
    renderApp({ client: createAnonymousApi(), route: '/login' });

    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    const alerts = screen.getAllByRole('alert');
    expect(alerts.map((node) => node.textContent)).toContain(
      'Enter the email address you signed up with.',
    );

    const email = screen.getByLabelText(/Email/);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    const describedBy = email.getAttribute('aria-describedby') ?? '';
    const errorNode = describedBy
      .split(' ')
      .map((id) => document.getElementById(id))
      .find((node) => node?.getAttribute('role') === 'alert');
    expect(errorNode?.textContent).toBe('Enter the email address you signed up with.');
  });

  it('wires a description to its field without claiming the field is invalid', () => {
    renderWithProviders(
      <TextField label="Setup token" description="Printed once to the terminal." />,
    );
    const input = screen.getByLabelText(/Setup token/);
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe(
      'Printed once to the terminal.',
    );
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('gives the layout a skip link, a labelled nav and a main landmark', async () => {
    renderApp({ route: '/' });

    await screen.findByRole('heading', { name: 'Dashboard', level: 1 });
    expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe(
      '#main',
    );
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
    expect(screen.getByRole('main').id).toBe('main');
  });
});

describe('shared form primitives', () => {
  it('labels a textarea and announces its error', () => {
    renderWithProviders(
      <TextArea label="Pasted profile text" error="This text is empty." required />,
    );
    const field = screen.getByLabelText(/Pasted profile text/);
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-required')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('This text is empty.');
  });

  it('labels a checkbox next to its box', () => {
    renderWithProviders(<Checkbox label="Keep the original CV file" defaultChecked />);
    const box = screen.getByLabelText('Keep the original CV file') as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(true);
  });

  it('groups radios under a legend and reports the chosen value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithProviders(
      <RadioGroup
        legend="Resume mode"
        name="resume_mode"
        value="original"
        onValueChange={onValueChange}
        options={[
          { value: 'original', label: 'Keep my original file' },
          { value: 'tailored', label: 'Generate a tailored CV' },
        ]}
      />,
    );

    const group = screen.getByRole('group', { name: 'Resume mode' });
    expect(group).toBeTruthy();
    expect((screen.getByLabelText('Keep my original file') as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByLabelText('Generate a tailored CV'));
    expect(onValueChange).toHaveBeenCalledWith('tailored');
  });
});

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Dialog
        open={open}
        title="Confirm something"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Confirm
            </Button>
          </>
        }
      >
        <p>Body text.</p>
      </Dialog>
    </div>
  );
}

describe('dialog', () => {
  it('traps focus, closes on Escape and restores focus to the opener', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    await user.click(opener);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Focus moved into the dialog.
    expect(dialog.contains(document.activeElement)).toBe(true);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(document.activeElement).toBe(cancel);

    await user.tab();
    expect(document.activeElement).toBe(confirm);

    // Tab from the last element wraps back to the first, never escaping.
    await user.tab();
    expect(document.activeElement).toBe(cancel);

    // Shift+Tab from the first wraps to the last.
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
