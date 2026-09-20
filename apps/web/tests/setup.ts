import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

beforeEach(() => {
  // Each test starts with no stored locale choice, so the locale under test is
  // whatever the test sets rather than whatever ran before it.
  globalThis.localStorage?.clear();
  document.documentElement.lang = 'en';
});

afterEach(() => {
  cleanup();
});
