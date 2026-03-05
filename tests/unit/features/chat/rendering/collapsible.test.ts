import type { CollapsibleState } from '@/features/chat/rendering/collapsible';
import { collapseElement,setupCollapsible } from '@/features/chat/rendering/collapsible';

function makeElements(): {
  wrapperEl: HTMLElement;
  headerEl: HTMLElement;
  contentEl: HTMLElement;
} {
  return {
    wrapperEl: document.createElement('div'),
    headerEl: document.createElement('div'),
    contentEl: document.createElement('div'),
  };
}

describe('setupCollapsible()', () => {
  describe('initial collapsed state (default)', () => {
    it('sets state.isExpanded to false', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: true };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);
      expect(state.isExpanded).toBe(false);
    });

    it('hides content element', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);
      expect(contentEl.style.display).toBe('none');
    });

    it('does not add "expanded" class to wrapper', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);
      expect(wrapperEl.classList.contains('expanded')).toBe(false);
    });

    it('sets aria-expanded to "false" on header', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);
      expect(headerEl.getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('initial expanded state (initiallyExpanded: true)', () => {
    it('sets state.isExpanded to true', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state, { initiallyExpanded: true });
      expect(state.isExpanded).toBe(true);
    });

    it('shows content element (display: block)', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state, { initiallyExpanded: true });
      expect(contentEl.style.display).toBe('block');
    });

    it('adds "expanded" class to wrapper', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state, { initiallyExpanded: true });
      expect(wrapperEl.classList.contains('expanded')).toBe(true);
    });

    it('sets aria-expanded to "true" on header', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state, { initiallyExpanded: true });
      expect(headerEl.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('click toggles expansion', () => {
    it('expands on first click (from collapsed)', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);

      headerEl.click();

      expect(state.isExpanded).toBe(true);
      expect(contentEl.style.display).toBe('block');
      expect(wrapperEl.classList.contains('expanded')).toBe(true);
      expect(headerEl.getAttribute('aria-expanded')).toBe('true');
    });

    it('collapses on second click (from expanded)', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);

      headerEl.click(); // expand
      headerEl.click(); // collapse

      expect(state.isExpanded).toBe(false);
      expect(contentEl.style.display).toBe('none');
      expect(wrapperEl.classList.contains('expanded')).toBe(false);
      expect(headerEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('calls onToggle callback with new state on each click', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      const onToggle = jest.fn();
      setupCollapsible(wrapperEl, headerEl, contentEl, state, { onToggle });

      headerEl.click();
      expect(onToggle).toHaveBeenCalledWith(true);

      headerEl.click();
      expect(onToggle).toHaveBeenCalledWith(false);

      expect(onToggle).toHaveBeenCalledTimes(2);
    });

    it('toggles from initiallyExpanded=true to collapsed on click', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state, { initiallyExpanded: true });

      headerEl.click();

      expect(state.isExpanded).toBe(false);
      expect(contentEl.style.display).toBe('none');
    });
  });

  describe('ARIA attributes', () => {
    it('sets aria-label with "click to expand" when collapsed (baseAriaLabel provided)', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state, { baseAriaLabel: 'Tool call' });
      expect(headerEl.getAttribute('aria-label')).toBe('Tool call - click to expand');
    });

    it('sets aria-label with "click to collapse" when expanded (baseAriaLabel provided)', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state, {
        initiallyExpanded: true,
        baseAriaLabel: 'Tool call',
      });
      expect(headerEl.getAttribute('aria-label')).toBe('Tool call - click to collapse');
    });

    it('updates aria-label on toggle', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state, { baseAriaLabel: 'Section' });

      headerEl.click();
      expect(headerEl.getAttribute('aria-label')).toBe('Section - click to collapse');

      headerEl.click();
      expect(headerEl.getAttribute('aria-label')).toBe('Section - click to expand');
    });

    it('does not set aria-label when baseAriaLabel is not provided', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);
      expect(headerEl.getAttribute('aria-label')).toBeNull();
    });

    it('sets aria-expanded to "false" initially', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);
      expect(headerEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('updates aria-expanded to "true" after expanding', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);
      headerEl.click();
      expect(headerEl.getAttribute('aria-expanded')).toBe('true');
    });
  });

  describe('keyboard navigation', () => {
    it('toggles on Enter key', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      headerEl.dispatchEvent(event);

      expect(state.isExpanded).toBe(true);
    });

    it('toggles on Space key', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);

      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true });
      headerEl.dispatchEvent(event);

      expect(state.isExpanded).toBe(true);
    });

    it('does not toggle on other keys', () => {
      const { wrapperEl, headerEl, contentEl } = makeElements();
      const state: CollapsibleState = { isExpanded: false };
      setupCollapsible(wrapperEl, headerEl, contentEl, state);

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      headerEl.dispatchEvent(event);

      expect(state.isExpanded).toBe(false);
    });
  });
});

describe('collapseElement()', () => {
  it('sets state.isExpanded to false', () => {
    const { wrapperEl, headerEl, contentEl } = makeElements();
    const state: CollapsibleState = { isExpanded: true };
    collapseElement(wrapperEl, headerEl, contentEl, state);
    expect(state.isExpanded).toBe(false);
  });

  it('hides content element', () => {
    const { wrapperEl, headerEl, contentEl } = makeElements();
    contentEl.style.display = 'block';
    const state: CollapsibleState = { isExpanded: true };
    collapseElement(wrapperEl, headerEl, contentEl, state);
    expect(contentEl.style.display).toBe('none');
  });

  it('removes "expanded" class from wrapper', () => {
    const { wrapperEl, headerEl, contentEl } = makeElements();
    wrapperEl.classList.add('expanded');
    const state: CollapsibleState = { isExpanded: true };
    collapseElement(wrapperEl, headerEl, contentEl, state);
    expect(wrapperEl.classList.contains('expanded')).toBe(false);
  });

  it('sets aria-expanded to "false" on header', () => {
    const { wrapperEl, headerEl, contentEl } = makeElements();
    headerEl.setAttribute('aria-expanded', 'true');
    const state: CollapsibleState = { isExpanded: true };
    collapseElement(wrapperEl, headerEl, contentEl, state);
    expect(headerEl.getAttribute('aria-expanded')).toBe('false');
  });

  it('is a no-op when already collapsed', () => {
    const { wrapperEl, headerEl, contentEl } = makeElements();
    contentEl.style.display = 'none';
    const state: CollapsibleState = { isExpanded: false };
    collapseElement(wrapperEl, headerEl, contentEl, state);
    expect(state.isExpanded).toBe(false);
    expect(contentEl.style.display).toBe('none');
  });
});
