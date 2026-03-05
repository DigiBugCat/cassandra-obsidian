/**
 * TabBar — renders tab buttons above the content area.
 *
 * Each tab shows a title with close button. Plus button creates new tabs.
 * Hidden when only one tab exists.
 */

import { setIcon } from 'obsidian';

export interface TabBarItem {
  id: string;
  title: string;
  isActive: boolean;
}

export interface TabBarCallbacks {
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: () => void;
}

export class TabBar {
  private el: HTMLElement;
  private callbacks: TabBarCallbacks;

  constructor(parentEl: HTMLElement, callbacks: TabBarCallbacks) {
    this.callbacks = callbacks;
    this.el = parentEl.createEl('div', { cls: 'cassandra-tab-bar' });
  }

  update(items: TabBarItem[]): void {
    this.el.empty();

    // Hide tab bar when only 1 tab
    this.el.style.display = items.length <= 1 ? 'none' : '';

    for (const item of items) {
      const tab = this.el.createEl('div', {
        cls: `cassandra-tab${item.isActive ? ' is-active' : ''}`,
      });

      const label = tab.createEl('span', { cls: 'cassandra-tab-label', text: item.title });
      label.setAttribute('title', item.title);

      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onTabClick(item.id);
      });

      // Close button (only show if more than 1 tab)
      if (items.length > 1) {
        const closeBtn = tab.createEl('span', { cls: 'cassandra-tab-close' });
        setIcon(closeBtn, 'x');
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.callbacks.onTabClose(item.id);
        });
      }
    }

    // New tab button
    const newTabBtn = this.el.createEl('div', { cls: 'cassandra-tab-new', attr: { 'aria-label': 'New tab' } });
    setIcon(newTabBtn, 'plus');
    newTabBtn.addEventListener('click', () => this.callbacks.onNewTab());
  }

  destroy(): void {
    this.el.remove();
  }
}
