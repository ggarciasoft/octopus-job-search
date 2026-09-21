import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { es } from '../src/i18n/es';
import { translate, type MessageKey } from '../src/i18n/messages';
import { renderApp } from './helpers';

const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((match) => match[1] as string).sort();
}

describe('message catalogues', () => {
  it('has identical key sets in English and Spanish', () => {
    const enKeys = Object.keys(en).sort();
    const esKeys = Object.keys(es).sort();

    expect(esKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
    expect(enKeys.filter((key) => !esKeys.includes(key))).toEqual([]);
    expect(esKeys).toEqual(enKeys);
  });

  it('has a non-empty translation for every key', () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(en[key].trim()).not.toBe('');
      expect(es[key].trim()).not.toBe('');
    }
  });

  it('uses the same placeholders in both languages', () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      expect({ key, placeholders: placeholders(es[key]) }).toEqual({
        key,
        placeholders: placeholders(en[key]),
      });
    }
  });

  it('substitutes parameters and leaves unknown ones visible', () => {
    expect(translate(en, 'auth.signedInAs', { email: 'a@b.test' })).toBe('Signed in as a@b.test');
    expect(translate(es, 'auth.signedInAs', { email: 'a@b.test' })).toBe(
      'Sesión iniciada como a@b.test',
    );
    expect(translate(en, 'common.requestId', {})).toBe('Request ID: {requestId}');
  });

  it('renders the dashboard in Spanish without leaking a raw catalogue key', async () => {
    globalThis.localStorage.setItem('job-getter.locale', 'es');
    renderApp({ route: '/' });

    await screen.findByRole('heading', { name: 'Panel', level: 1 });
    expect(document.documentElement.lang).toBe('es');

    const rendered = document.body.textContent ?? '';
    const leaked = (Object.keys(en) as MessageKey[]).filter((key) => rendered.includes(key));
    expect(leaked).toEqual([]);
  });

  for (const [route, heading, control] of [
    ['/profile', 'Perfil', /^Añadir/],
    ['/profile/import', 'Revisión de importación', /^Encolar extracción/],
    ['/settings/preferences', 'Ajustes', /^Guardar preferencias/],
    ['/settings/provider', 'Ajustes', /^Guardar ajustes del proveedor/],
    ['/discover', 'Descubrir', /^Añadir tablón/],
    ['/jobs', 'Empleos', /^Aplicar filtros/],
  ] as const) {
    it(`renders ${route} in Spanish without leaking a raw catalogue key`, async () => {
      globalThis.localStorage.setItem('job-getter.locale', 'es');
      renderApp({ route });

      await screen.findByRole('heading', { name: heading, level: 1 });
      // Wait for the data-driven form below the heading, not just the shell.
      await screen.findAllByRole('button', { name: control });

      const rendered = document.body.textContent ?? '';
      const leaked = (Object.keys(en) as MessageKey[]).filter((key) => rendered.includes(key));
      expect(leaked).toEqual([]);
    });
  }

  it('renders the diagnostics screen in English without leaking a raw catalogue key', async () => {
    renderApp({ route: '/diagnostics' });

    await screen.findByRole('heading', { name: 'Diagnostics', level: 1 });
    expect(document.documentElement.lang).toBe('en');

    const rendered = document.body.textContent ?? '';
    const leaked = (Object.keys(en) as MessageKey[]).filter((key) => rendered.includes(key));
    expect(leaked).toEqual([]);
  });
});
