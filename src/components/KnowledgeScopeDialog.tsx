import { useEffect, useMemo, useState } from 'react';
import type { RagDocumentStatus, RagScope } from '../../shared/protocol';
import { normalizeRagScopeSelection } from '../../shared/ragScopeSelection';
import { useT } from '../i18n';

export { normalizeRagScopeSelection } from '../../shared/ragScopeSelection';

type ScopeMode = 'disabled' | 'all' | 'selected';

interface ScopeNode {
  path: string;
  name: string;
  kind: 'folder' | 'file';
  children: ScopeNode[];
}

function buildTree(documents: RagDocumentStatus[]): ScopeNode[] {
  const root: ScopeNode = { path: '', name: '', kind: 'folder', children: [] };
  for (const document of documents) {
    const parts = document.relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
    let parent = root;
    for (let index = 0; index < parts.length; index++) {
      const path = parts.slice(0, index + 1).join('/');
      const kind = index === parts.length - 1 ? 'file' : 'folder';
      let node = parent.children.find((child) => child.path === path);
      if (!node) {
        node = { path, name: parts[index], kind, children: [] };
        parent.children.push(node);
      }
      parent = node;
    }
  }
  const sort = (nodes: ScopeNode[]): ScopeNode[] =>
    nodes
      .map((node) => ({ ...node, children: sort(node.children) }))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, 'en');
      });
  return sort(root.children);
}

function filterTree(nodes: ScopeNode[], query: string): ScopeNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return nodes;
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, needle);
    return node.path.toLocaleLowerCase().includes(needle) || children.length
      ? [{ ...node, children }]
      : [];
  });
}

function ScopeTree({
  nodes,
  selected,
  onToggle,
  depth = 0,
}: {
  nodes: ScopeNode[];
  selected: string[];
  onToggle(path: string, checked: boolean): void;
  depth?: number;
}) {
  return nodes.map((node) => {
    const covered = selected.some((parent) => node.path.startsWith(`${parent}/`));
    const checked = covered || selected.includes(node.path);
    return (
      <div key={node.path} className="scope-tree-node">
        <label className="scope-tree-row" style={{ paddingLeft: depth * 14 }} title={node.path}>
          <input
            type="checkbox"
            checked={checked}
            disabled={covered}
            onChange={(event) => onToggle(node.path, event.target.checked)}
          />
          <span aria-hidden="true">{node.kind === 'folder' ? '▸' : '·'}</span>
          <span>{node.name}</span>
        </label>
        {node.children.length > 0 && (
          <ScopeTree
            nodes={node.children}
            selected={selected}
            onToggle={onToggle}
            depth={depth + 1}
          />
        )}
      </div>
    );
  });
}

export function KnowledgeScopeDialog({
  open,
  documents,
  value,
  onChange,
  onClose,
}: {
  open: boolean;
  documents: RagDocumentStatus[];
  value: RagScope;
  onChange(scope: RagScope): void;
  onClose(): void;
}) {
  const t = useT();
  const copy = t.answer.scope;
  const [mode, setMode] = useState<ScopeMode>('disabled');
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const knownPaths = useMemo(() => documents.map((document) => document.relativePath), [documents]);
  const tree = useMemo(() => filterTree(buildTree(documents), query), [documents, query]);

  useEffect(() => {
    if (!open) return;
    setMode(!value.enabled ? 'disabled' : value.includePaths?.length ? 'selected' : 'all');
    setSelected(normalizeRagScopeSelection(value.includePaths ?? [], knownPaths, window.mc.platform));
    setQuery('');
  }, [open, value, knownPaths]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (path: string, checked: boolean) => {
    const next = checked ? [...selected, path] : selected.filter((value) => value !== path);
    setSelected(normalizeRagScopeSelection(next, knownPaths, window.mc.platform));
  };

  const save = () => {
    if (mode === 'disabled') onChange({ enabled: false });
    else if (mode === 'all') onChange({ enabled: true });
    else onChange({ enabled: true, includePaths: selected });
    onClose();
  };

  return (
    <div className="scope-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="scope-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scope-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="scope-dialog-head">
          <strong id="scope-dialog-title">{copy.title}</strong>
          <button className="btn btn-sm" type="button" onClick={onClose} title={copy.cancel}>
            ×
          </button>
        </div>

        <div className="scope-modes" role="group" aria-label={copy.title}>
          {(['disabled', 'all', 'selected'] as const).map((item) => (
            <button
              key={item}
              className={mode === item ? 'btn btn-sm btn-on' : 'btn btn-sm'}
              type="button"
              aria-pressed={mode === item}
              onClick={() => setMode(item)}
            >
              {copy.modes[item]}
            </button>
          ))}
        </div>

        {documents.length === 0 && <div className="settings-warn">{copy.unavailable}</div>}

        {mode === 'selected' && (
          <>
            <input
              className="scope-search"
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.search}
            />
            <div className="scope-tree">
              {documents.length === 0 ? null : tree.length === 0 ? (
                <div className="pane-empty">{copy.noMatches}</div>
              ) : (
                <ScopeTree nodes={tree} selected={selected} onToggle={toggle} />
              )}
            </div>
          </>
        )}

        <div className="scope-dialog-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={mode === 'selected' && selected.length === 0}
            onClick={save}
          >
            {copy.save}
          </button>
          <button className="btn" type="button" onClick={onClose}>
            {copy.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
