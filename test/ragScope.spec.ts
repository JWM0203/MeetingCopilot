import { describe, expect, it } from 'vitest';
import { normalizeRagScopeSelection } from '../shared/ragScopeSelection';

const known = [
  'projects/payments/api.md',
  'projects/payments/runbook.pdf',
  'resume/current.docx',
  'notes/interview.txt',
];

describe('normalizeRagScopeSelection', () => {
  it('normalizes slashes, trims separators, and sorts stably', () => {
    expect(
      normalizeRagScopeSelection(
        ['resume\\current.docx', 'notes/interview.txt/', 'projects\\payments\\api.md'],
        known,
        'linux',
      ),
    ).toEqual(['notes/interview.txt', 'projects/payments/api.md', 'resume/current.docx']);
  });

  it('deduplicates Windows paths case-insensitively', () => {
    expect(
      normalizeRagScopeSelection(
        ['Projects/Payments/API.md', 'projects/payments/api.md'],
        known,
        'win32',
      ),
    ).toEqual(['Projects/Payments/API.md']);
  });

  it('lets a selected parent folder dominate descendants', () => {
    expect(
      normalizeRagScopeSelection(
        ['projects/payments/api.md', 'projects', 'projects/payments/runbook.pdf'],
        known,
      ),
    ).toEqual(['projects']);
  });

  it('removes unknown, absolute, and root-escaping paths', () => {
    expect(
      normalizeRagScopeSelection(
        ['missing/file.md', '../secret.md', 'C:\\secret.md', '/projects/payments', 'projects/payments/api.md'],
        known,
        'win32',
      ),
    ).toEqual(['projects/payments/api.md']);
  });
});
