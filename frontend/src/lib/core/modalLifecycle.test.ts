import { describe, expect, it } from 'vitest';
import { createModalLifecycle } from './modalLifecycle';

function backgrounds() {
  const elements: HTMLElement[] = [];
  const document = {
    querySelectorAll(selector: string) {
      expect(selector).toBe('#app, [data-dialog-content]');
      return elements;
    },
  };
  const node = (inert = false) => {
    const element = {
      inert,
      ownerDocument: document,
      contains: (other: unknown) => other === element,
    } as unknown as HTMLElement;
    elements.push(element);
    return element;
  };
  return { node };
}

describe('modal background inertness', () => {
  it('inerts the application and other dialogs, not the opened dialog', () => {
    const { node } = backgrounds();
    const app = node();
    const closedDialog = node(true);
    const panel = node();
    const modal = createModalLifecycle();
    modal.open(panel);
    expect(app.inert).toBe(true);
    expect(closedDialog.inert).toBe(true);
    expect(panel.inert).toBe(false);
    modal.close();
    modal.close();
    expect(app.inert).toBe(false);
    expect(closedDialog.inert).toBe(true);
  });

  it('does not inert a container that contains the opened dialog', () => {
    const { node } = backgrounds();
    const app = node();
    const panel = node();
    app.contains = other => other === app || other === panel;
    const modal = createModalLifecycle();
    modal.open(panel);
    expect(app.inert).toBe(false);
    expect(panel.inert).toBe(false);
    modal.close();
  });

  it.each(['inner-first', 'outer-first'])(
    'restores nested locks correctly in %s close order',
    order => {
      const { node } = backgrounds();
      const app = node();
      const outerPanel = node();
      const outer = createModalLifecycle();
      outer.open(outerPanel);
      const innerPanel = node();
      const inner = createModalLifecycle();
      inner.open(innerPanel);
      expect(app.inert).toBe(true);
      expect(outerPanel.inert).toBe(true);
      expect(innerPanel.inert).toBe(false);
      if (order === 'inner-first') {
        inner.close();
        expect(outerPanel.inert).toBe(false);
        expect(app.inert).toBe(true);
        outer.close();
      } else {
        outer.close();
        expect(app.inert).toBe(true);
        inner.close();
      }
      expect(app.inert).toBe(false);
      expect(outerPanel.inert).toBe(false);
    },
  );

  it('releases previous locks on repeated open and on a missing node', () => {
    const { node } = backgrounds();
    const app = node();
    const panel = node();
    const modal = createModalLifecycle();
    modal.open(panel);
    modal.open(panel);
    modal.close();
    expect(app.inert).toBe(false);
    modal.open(panel);
    modal.open(null);
    expect(app.inert).toBe(false);
  });
});
