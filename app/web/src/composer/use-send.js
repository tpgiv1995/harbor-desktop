import { useCallback, useEffect, useState } from 'react';
import { useRpc } from '../rpc/rpc-context.jsx';

const EMPTY_QUEUE = { count: 0, items: [] };

function reasonFrom(error) {
  return String(error?.message || error || 'send failed');
}

export function useSend({ sessionId, paneId, onSent }) {
  const client = useRpc();
  const [queue, setQueue] = useState(EMPTY_QUEUE);
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  const showResult = useCallback((result, fallback) => {
    if (result?.ok === false) {
      setStatus({ phase: 'error', detail: String(result.reason) });
      return false;
    }
    if (result == null) return true;
    if (result.ok !== true) {
      setStatus({ phase: 'error', detail: fallback });
      return false;
    }
    return true;
  }, []);

  const refreshQueue = useCallback(async () => {
    try {
      const next = await client.call('session:send-queue', { sessionId });
      setQueue(next || EMPTY_QUEUE);
    } catch (error) {
      setStatus({ phase: 'error', detail: reasonFrom(error) });
    }
  }, [client, sessionId]);

  useEffect(() => {
    setQueue(EMPTY_QUEUE);
    setStatus(null);
    refreshQueue();
    return client.onChannel('send:status', (next) => {
      if (next?.sessionId !== sessionId) return;
      setStatus(next);
      if (next.queue) setQueue(next.queue);
      else refreshQueue();
    });
  }, [client, refreshQueue, sessionId]);

  const send = useCallback(async (text, images = []) => {
    setSending(true);
    setStatus(null);
    const pane = paneId ? { paneId } : null;
    try {
      const result = await client.call('session:send', {
        sessionId,
        text,
        images,
        pane,
        resumeOnly: false,
      });
      const ok = showResult(result, 'send failed');
      await refreshQueue();
      if (ok) onSent?.(result);
      return { ok, result };
    } catch (error) {
      const reason = reasonFrom(error);
      setStatus({ phase: 'error', detail: reason });
      return { ok: false, result: { ok: false, reason } };
    } finally {
      setSending(false);
    }
  }, [client, onSent, paneId, refreshQueue, sessionId, showResult]);

  const cancel = useCallback(async (sendId) => {
    try {
      const result = await client.call('session:cancel-send', { sessionId, sendId });
      showResult(result, 'cancel failed');
      await refreshQueue();
      return result;
    } catch (error) {
      setStatus({ phase: 'error', detail: reasonFrom(error) });
      return null;
    }
  }, [client, refreshQueue, sessionId, showResult]);

  const interrupt = useCallback(async () => {
    try {
      const result = await client.call('session:interrupt', { paneId });
      showResult(result, 'interrupt failed');
      return result;
    } catch (error) {
      setStatus({ phase: 'error', detail: reasonFrom(error) });
      return null;
    }
  }, [client, paneId, showResult]);

  return { cancel, interrupt, queue, send, sending, status };
}
