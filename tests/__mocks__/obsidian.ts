// Minimal Obsidian mock for Cassandra tests

export class Plugin {
  app: any;
  manifest: any;

  constructor() {
    this.app = {
      vault: {
        adapter: { basePath: '/mock/vault' },
        getAbstractFileByPath: () => null,
        getFiles: () => [],
        getName: () => 'Mock Vault',
      },
      workspace: {
        getLeavesOfType: () => [],
        getRightLeaf: () => null,
        getLeftLeaf: () => null,
        revealLeaf: () => {},
        on: () => ({ id: 'mock' }),
        off: () => {},
      },
    };
    this.manifest = { id: 'cassandra-obsidian', version: '0.1.0' };
  }

  addCommand() {}
  addRibbonIcon() {}
  addSettingTab() {}
  registerView() {}
  loadData() { return Promise.resolve(null); }
  saveData() { return Promise.resolve(); }
}

export class ItemView {
  leaf: any;
  containerEl: any;
  contentEl: any;

  constructor(leaf: any) {
    this.leaf = leaf;
    this.containerEl = {
      children: [null, { empty: () => {}, createEl: () => ({}) }],
      createEl: () => ({}),
      empty: () => {},
    };
    this.contentEl = { empty: () => {}, createEl: () => ({}) };
  }

  getViewType() { return ''; }
  getDisplayText() { return ''; }
  getIcon() { return ''; }
}

export class WorkspaceLeaf {
  view: any = null;
  setViewState() { return Promise.resolve(); }
}

export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

export class Menu {
  addItem(callback: (item: any) => void) {
    const item = {
      setTitle: () => item,
      setIcon: () => item,
      onClick: () => item,
    };
    callback(item);
    return this;
  }

  showAtMouseEvent() {}
}

export class Modal {
  app: any;
  contentEl: any;
  modalEl: any;

  constructor(app: any) {
    this.app = app;
    this.contentEl = { empty: () => {}, createEl: () => ({}) };
    this.modalEl = { addClass: () => {} };
  }

  open() {}
  close() {}
  setTitle() {}
}

export class PluginSettingTab {
  app: any;
  plugin: any;
  containerEl: any;

  constructor(app: any, plugin: any) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = { empty: () => {}, createEl: () => ({}) };
  }

  display() {}
  hide() {}
}

export class Setting {
  settingEl: any = { createEl: () => ({}) };

  constructor(_containerEl: any) {}

  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addToggle() { return this; }
  addDropdown() { return this; }
  addButton() { return this; }
  addTextArea() { return this; }
  setClass() { return this; }
}

export function setIcon(_el: any, _icon: string) {}

export function requestUrl(_options: any) {
  return Promise.resolve({ json: {}, text: '', status: 200 });
}

export class Component {
  register() {}
  registerEvent() {}
  load() {}
  onload() {}
  unload() {}
  onunload() {}
  addChild() { return {} as any; }
  removeChild() {}
}

export class MarkdownRenderer {
  static render() { return Promise.resolve(); }
  static renderMarkdown() { return Promise.resolve(); }
}

export type EventRef = { id: string };
export class TFile { path = ''; basename = ''; extension = ''; }
