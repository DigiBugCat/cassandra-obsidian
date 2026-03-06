/**
 * ImageContextManager — handles image paste/drop into the composer.
 *
 * Manages pending images, renders thumbnail previews in the context row,
 * and provides the image list for sending with messages.
 * Mobile-safe: no Node.js imports, uses FileReader for base64 conversion.
 */

import { Notice, setIcon } from 'obsidian';

import { createLogger } from '../../../core/logging';
import type { ImageAttachment, ImageMediaType } from '../../../core/types';

const log = createLogger('ImageContextManager');

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMAGES = 5;

const SUPPORTED_TYPES: Record<string, ImageMediaType> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

export interface ImageContextCallbacks {
  onImagesChanged: () => void;
  onFileDropped?: (fileName: string, file?: File) => void;
}

export class ImageContextManager {
  private images: Map<string, ImageAttachment> = new Map();
  private contextRowEl: HTMLElement;
  private previewEl: HTMLElement;
  private callbacks: ImageContextCallbacks;
  private dropOverlay: HTMLElement | null = null;
  private dropOverlayLabel: HTMLElement | null = null;

  constructor(
    composerEl: HTMLElement,
    contextRowEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: ImageContextCallbacks,
  ) {
    this.contextRowEl = contextRowEl;
    this.callbacks = callbacks;
    this.previewEl = contextRowEl.createEl('div', { cls: 'cassandra-image-preview' });

    this.setupPasteHandler(inputEl);
    this.setupDragAndDrop(composerEl);
  }

  getImages(): ImageAttachment[] {
    return Array.from(this.images.values());
  }

  hasImages(): boolean {
    return this.images.size > 0;
  }

  clearImages(): void {
    this.images.clear();
    this.updatePreview();
    this.callbacks.onImagesChanged();
  }

  // ── Paste handler ──────────────────────────────────────────────

  private setupPasteHandler(inputEl: HTMLTextAreaElement): void {
    inputEl.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue;
        const file = item.getAsFile();
        if (!file) continue;

        e.preventDefault();
        await this.addImageFile(file, 'paste');
        return;
      }
    });
  }

  // ── Drag and drop ──────────────────────────────────────────────

  private setupDragAndDrop(composerEl: HTMLElement): void {
    this.dropOverlay = composerEl.createEl('div', { cls: 'cassandra-drop-overlay' });
    this.dropOverlayLabel = this.dropOverlay.createEl('span', { text: 'Drop file here' });
    this.dropOverlay.style.display = 'none';

    let dragCounter = 0;

    composerEl.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (this.hasDraggableContent(e)) {
        this.dropOverlay!.style.display = '';
        // Update label based on drag content
        const hasImage = this.hasImageInDragEvent(e);
        this.dropOverlayLabel!.textContent = hasImage ? 'Drop image here' : 'Drop file here';
      }
    });

    composerEl.addEventListener('dragleave', () => {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        this.dropOverlay!.style.display = 'none';
      }
    });

    composerEl.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    composerEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      this.dropOverlay!.style.display = 'none';

      // Debug: log all dataTransfer content
      const dt = e.dataTransfer;
      const types = dt ? Array.from(dt.types) : [];
      const textData = dt?.getData('text/plain') ?? '';
      const textHtml = dt?.getData('text/html') ?? '';
      const files = dt?.files;
      const fileList = files ? Array.from(files).map(f => ({ name: f.name, type: f.type, size: f.size })) : [];
      log.info('drop_event', { types, textData: textData.slice(0, 200), textHtml: textHtml.slice(0, 200), files: fileList });

      // Handle image file drops first
      if (files && files.length > 0) {
        let handledImage = false;
        for (const file of Array.from(files)) {
          if (SUPPORTED_TYPES[file.type]) {
            await this.addImageFile(file, 'drop');
            handledImage = true;
          }
        }
        if (handledImage) return;
      }

      // Handle Obsidian internal drag (text/plain contains vault-relative path)
      if (textData && this.callbacks.onFileDropped) {
        const path = textData.trim();
        if (path && !path.startsWith('http') && (path.endsWith('.md') || path.includes('/'))) {
          this.callbacks.onFileDropped(path);
          return;
        }
      }

      // Handle non-image file drops (Obsidian file explorer or OS files)
      if (files && files.length > 0 && this.callbacks.onFileDropped) {
        for (const file of Array.from(files)) {
          if (!SUPPORTED_TYPES[file.type] && file.name) {
            this.callbacks.onFileDropped(file.name, file);
          }
        }
      }
    });
  }

  private hasDraggableContent(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    const arr = Array.from(types);
    return arr.includes('Files') || arr.includes('text/plain');
  }

  private hasImageInDragEvent(e: DragEvent): boolean {
    const items = e.dataTransfer?.items;
    if (!items) return false;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) return true;
    }
    return false;
  }

  // ── Image processing ───────────────────────────────────────────

  private async addImageFile(file: File, source: 'paste' | 'drop' | 'file'): Promise<void> {
    if (!SUPPORTED_TYPES[file.type]) {
      new Notice(`Unsupported image type: ${file.type}`);
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      new Notice(`Image too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 5MB.`);
      return;
    }

    if (this.images.size >= MAX_IMAGES) {
      new Notice(`Max ${MAX_IMAGES} images per message.`);
      return;
    }

    const data = await this.fileToBase64(file);
    const attachment: ImageAttachment = {
      id: crypto.randomUUID(),
      name: file.name || `image.${file.type.split('/')[1]}`,
      mediaType: SUPPORTED_TYPES[file.type],
      data,
      size: file.size,
      source,
    };

    this.images.set(attachment.id, attachment);
    this.updatePreview();
    this.callbacks.onImagesChanged();
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip data URL prefix: "data:image/png;base64,..."
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(file);
    });
  }

  // ── Preview rendering ──────────────────────────────────────────

  private updatePreview(): void {
    this.previewEl.empty();

    if (this.images.size === 0) {
      this.contextRowEl.classList.remove('has-content');
      return;
    }

    this.contextRowEl.classList.add('has-content');

    for (const img of this.images.values()) {
      const thumb = this.previewEl.createEl('div', { cls: 'cassandra-image-thumb' });

      const imgEl = thumb.createEl('img', {
        attr: { src: `data:${img.mediaType};base64,${img.data}`, alt: img.name },
      });
      imgEl.style.maxWidth = '48px';
      imgEl.style.maxHeight = '48px';

      const removeBtn = thumb.createEl('span', { cls: 'cassandra-image-thumb-remove' });
      setIcon(removeBtn, 'x');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.images.delete(img.id);
        this.updatePreview();
        this.callbacks.onImagesChanged();
      });
    }
  }

  destroy(): void {
    this.images.clear();
  }
}
