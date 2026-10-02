import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { buildLabel } from './build-info.ts';

describe('App shell', () => {
  it('renders the placeholder Welcome with the build label', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Drone Lap Counter' })).toBeTruthy();
    expect(screen.getByTestId('build-label').textContent).toBe(buildLabel);
  });
});
