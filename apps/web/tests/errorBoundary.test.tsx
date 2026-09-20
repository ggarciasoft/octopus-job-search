import { ApiError } from '@job-getter/api-client';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from './helpers';

function Boom(): never {
  throw new ApiError({
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Kaboom in a child component',
    requestId: '77777777-7777-4777-8777-777777777777',
  });
}

describe('top-level error boundary', () => {
  beforeEach(() => {
    // React logs the caught error; the test asserts the UI, not the console.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the real error and its request id instead of a blank screen', () => {
    const { container } = renderWithProviders(<Boom />);

    expect(screen.getByText('This screen stopped working')).toBeTruthy();
    expect(screen.getByText('Kaboom in a child component')).toBeTruthy();
    expect(screen.getByText('INTERNAL_ERROR')).toBeTruthy();
    expect(screen.getByText('Request ID: 77777777-7777-4777-8777-777777777777')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(container.textContent?.trim()).not.toBe('');
  });
});
