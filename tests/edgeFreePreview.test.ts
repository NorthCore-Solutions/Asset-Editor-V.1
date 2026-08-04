import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getEdgeFreePreview,
  setEdgeFreePreview,
  subscribeEdgeFreePreview
} from '../src/editor/view/edgeFreePreviewSession';

afterEach(() => setEdgeFreePreview(false));

describe('Kantenfreie Vorschau', () => {
  it('ist standardmäßig deaktiviert und lässt sich umschalten', () => {
    expect(getEdgeFreePreview()).toBe(false);
    setEdgeFreePreview(true);
    expect(getEdgeFreePreview()).toBe(true);
  });

  it('informiert Abonnenten nur bei einer tatsächlichen Änderung', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEdgeFreePreview(listener);

    setEdgeFreePreview(true);
    setEdgeFreePreview(true);
    setEdgeFreePreview(false);
    unsubscribe();
    setEdgeFreePreview(true);

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
