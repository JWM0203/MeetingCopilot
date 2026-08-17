/**
 * Renderer entry for the setup window (src/setup.html).
 * The main overlay keeps its own entry (src/main.tsx) untouched.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { OnboardingApp } from './onboarding/OnboardingApp';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OnboardingApp />
  </React.StrictMode>,
);
