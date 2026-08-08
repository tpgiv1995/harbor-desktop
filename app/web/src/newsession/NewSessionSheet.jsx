import React, {
  useCallback, useEffect, useMemo, useState,
} from 'react';
import { CONNECTION } from '../rpc/client.js';
import './newsession.css';

const PROVIDER_LABEL = {
  claude: 'Claude',
  codex: 'Codex',
  cursor: 'Cursor',
};

function folderLabel(folder) {
  const parts = String(folder || '').split(/[/\\]/).filter(Boolean);
  if (!parts.length) return folder || 'Folder';
  return parts.length > 2 ? parts.slice(-2).join('/') : parts[parts.length - 1];
}

async function waitForSessionInFolder(client, folder, { timeoutMs = 12000, sinceMs } = {}) {
  const target = folder;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await client.call('sidebar:get-state');
    const sessions = (state?.model?.projects || []).flatMap((project) => project.sessions || []);
    const match = sessions
      .filter((session) => session.cwd === target)
      .sort((left, right) => (right.lastActiveMs || 0) - (left.lastActiveMs || 0))[0];
    if (match?.id && (sinceMs == null || (match.lastActiveMs || 0) >= sinceMs - 2000)) {
      return match.id;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

export function NewSessionSheet({
  open,
  onClose,
  onCreated,
  client,
}) {
  const [options, setOptions] = useState(null);
  const [folders, setFolders] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [folder, setFolder] = useState('');
  const [account, setAccount] = useState('');
  const [provider, setProvider] = useState('claude');
  const [model, setModel] = useState('opus');
  const [effort, setEffort] = useState('xhigh');
  const [starting, setStarting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const connected = client?.getState() === CONNECTION.connected;
  const providerKeys = useMemo(
    () => Object.keys(options?.providers || {}),
    [options],
  );
  const providerOptions = options?.providers?.[provider];
  const modelOptions = providerOptions?.models || [];
  const effortLevels = (providerOptions?.efforts || []).filter((value) => value !== 'default');
  const profileOptions = options?.profiles || [];

  useEffect(() => {
    if (!open || !client || !connected) return undefined;
    let cancelled = false;
    setLoadError(null);
    setSubmitError(null);
    Promise.all([
      client.call('new-session:options'),
      client.call('new-session:folder'),
    ])
      .then(([nextOptions, nextFolders]) => {
        if (cancelled) return;
        setOptions(nextOptions);
        const candidates = Array.isArray(nextFolders) ? nextFolders : [];
        setFolders(candidates);
        const defaults = nextOptions?.defaults || {};
        const defaultProvider = defaults.provider || 'claude';
        const defaultModel = defaults.model || 'opus';
        const defaultEffort = defaults.effort || 'xhigh';
        const defaultProfile = nextOptions?.profiles?.find((row) => row.isDefault)?.id
          || nextOptions?.accounts?.[0]
          || '';
        setProvider(defaultProvider);
        setModel(defaultModel);
        setEffort(defaultEffort);
        setAccount(defaultProfile);
        setFolder(candidates[0] || '');
      })
      .catch((error) => {
        if (!cancelled) setLoadError(String(error.message || error));
      });
    return () => { cancelled = true; };
  }, [open, client, connected]);

  useEffect(() => {
    if (!open || !providerOptions) return;
    if (!providerOptions.models?.some((row) => row.value === model)) {
      setModel(providerOptions.defaultModel || providerOptions.models?.[0]?.value || 'default');
    }
    const levels = (providerOptions.efforts || []).filter((value) => value !== 'default');
    if (levels.length && !levels.includes(effort)) {
      setEffort(providerOptions.defaultEffort || levels[0] || 'default');
    }
  }, [open, provider, providerOptions, model, effort]);

  const onBackdrop = useCallback((event) => {
    if (event.target === event.currentTarget && !starting) onClose();
  }, [onClose, starting]);

  const submit = async (event) => {
    event.preventDefault();
    if (!client || !connected || !folder || !providerOptions || starting) return;
    setStarting(true);
    setSubmitError(null);
    const sinceMs = Date.now();
    try {
      await client.call('new-session', {
        account,
        folder,
        provider,
        model,
        effort,
      });
      const sessionId = await waitForSessionInFolder(client, folder, { sinceMs });
      onCreated?.({ sessionId, folder, provider, model, effort });
      onClose();
    } catch (error) {
      setSubmitError(String(error.message || error));
    } finally {
      setStarting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="newsession-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="New session"
      onMouseDown={onBackdrop}
    >
      <form className="newsession-panel" onSubmit={submit}>
        <header className="newsession-head">
          <h2 className="newsession-title">New session</h2>
          <button
            type="button"
            className="newsession-close"
            onClick={onClose}
            disabled={starting}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {loadError ? <div className="newsession-error" role="alert">{loadError}</div> : null}
        {submitError ? <div className="newsession-error" role="alert">{submitError}</div> : null}

        <div className="newsession-body">
          <fieldset className="newsession-field">
            <legend>Project folder</legend>
            {folders.length ? (
              <div className="newsession-folder-list" role="listbox" aria-label="Project folders">
                {folders.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    role="option"
                    aria-selected={candidate === folder}
                    className={`newsession-folder${candidate === folder ? ' on' : ''}`}
                    onClick={() => setFolder(candidate)}
                  >
                    <span className="newsession-folder-label">{folderLabel(candidate)}</span>
                    <span className="newsession-folder-path">{candidate}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="newsession-empty">No candidate folders from the server.</p>
            )}
          </fieldset>

          {profileOptions.length > 1 ? (
            <fieldset className="newsession-field">
              <legend>Account</legend>
              <select
                className="newsession-select"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                aria-label="Account"
              >
                {profileOptions.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label || profile.id}</option>
                ))}
              </select>
            </fieldset>
          ) : null}

          <fieldset className="newsession-field">
            <legend>Provider</legend>
            <div className="newsession-providers">
              {providerKeys.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`newsession-provider${provider === key ? ' on' : ''}`}
                  onClick={() => setProvider(key)}
                >
                  {PROVIDER_LABEL[key] || key}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="newsession-field">
            <legend>Model</legend>
            <select
              className="newsession-select"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              aria-label="Model"
            >
              {modelOptions.map((row) => (
                <option key={row.value} value={row.value}>{row.label || row.value}</option>
              ))}
            </select>
          </fieldset>

          {effortLevels.length ? (
            <fieldset className="newsession-field">
              <legend>Effort</legend>
              <div className="newsession-efforts">
                {effortLevels.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`newsession-effort${effort === level ? ' on' : ''}`}
                    onClick={() => setEffort(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
        </div>

        <footer className="newsession-foot">
          <button
            type="submit"
            className="btn-primary newsession-start"
            disabled={!folder || !providerOptions || starting || !connected}
          >
            {starting ? 'Starting…' : 'Start session'}
          </button>
        </footer>
      </form>
    </div>
  );
}
