/**
 * ImageContextManager — handles image paste/drop into the composer.
 *
 * Manages pending images, renders thumbnail previews in the context row,
 * and provides the image list for sending with messages.
 * Mobile-safe: no Node.js imports, uses FileReader for base64 conversion.
 */

import { Notice, setIcon } from 'obsidian';

import type { ImageAttachment, ImageMediaType } from '../../../core/types';

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
}

export class ImageContextManager {
  private images: Map<string, ImageAttachment> = new Map();
  private contextRowEl: HTMLElement;
  private previewEl: HTMLElement;
  private callbacks: ImageContextCallbacks;
  private dropOverlay: HTMLElement | null = null;

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
    this.dropOverlay.createEl('span', { text: 'Drop image here' });
    this.dropOverlay.style.display = 'none';

    let dragCounter = 0;

    composerEl.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (this.hasImageInDragEvent(e)) {
        this.dropOverlay!.style.display = '';
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

      const files = e.dataTransfer?.files;
      if (!files) return;

      for (const file of Array.from(files)) {
        if (SUPPORTED_TYPES[file.type]) {
          await this.addImageFile(file, 'drop');
        }
      }
    });
  }

  private hasImageInDragEvent(e: DragEvent): boolean {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    return Array.from(types).includes('Files');
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
