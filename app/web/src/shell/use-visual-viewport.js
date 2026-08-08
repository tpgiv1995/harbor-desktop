import { useEffect, useState } from 'react';

/**
 * Tracks the rectangle iOS says is visible. No keyboard state is inferred:
 * standalone Safari may resize both viewports, so their height delta is not a
 * keyboard signal.
 */
export function useVisualViewport() {
  const [viewport, setViewport] = useState(() => readViewport());

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;

    const update = () => {
      const next = readViewport();
      setViewport(next);
      applyViewportCss(next);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      clearViewportCss();
    };
  }, []);

  return viewport;
}

function readViewport() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  return {
    height: vv?.height ?? window.innerHeight,
    offsetTop: vv?.offsetTop ?? 0,
    offsetLeft: vv?.offsetLeft ?? 0,
    width: vv?.width ?? window.innerWidth,
  };
}

/** Write visual-viewport dimensions to :root so the shell can shrink with the keyboard. */
function applyViewportCss(viewport) {
  const root = document.documentElement;
  const { body } = document;
  root.style.setProperty('--app-h', `${viewport.height}px`);
  root.style.setProperty('--app-offset-top', `${viewport.offsetTop}px`);
  root.style.setProperty('--app-offset-left', `${viewport.offsetLeft}px`);
  root.style.setProperty('--app-w', `${viewport.width}px`);
  root.style.overflow = 'hidden';
  if (body) body.style.overflow = 'hidden';
  const mount = document.getElementById('root');
  if (mount) mount.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    const conv = document.querySelector('.conv');
    if (conv) conv.scrollTop = conv.scrollHeight;
  });
}

function clearViewportCss() {
  const root = document.documentElement;
  const { body } = document;
  root.style.removeProperty('--app-h');
  root.style.removeProperty('--app-offset-top');
  root.style.removeProperty('--app-offset-left');
  root.style.removeProperty('--app-w');
  root.style.overflow = '';
  if (body) {
    body.style.overflow = '';
  }
  const mount = document.getElementById('root');
  if (mount) {
    mount.style.overflow = '';
  }
}
