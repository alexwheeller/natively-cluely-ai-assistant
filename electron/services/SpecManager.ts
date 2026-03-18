import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
const pdfParse = require('pdf-parse');

export interface SpecDefinition {
  id: string;
  name: string;
  prompt: string;
  filePaths: string[];
  updatedAt?: string;
  createdAt?: string;
}

export class SpecManager {
  private static instance: SpecManager;
  private specs: SpecDefinition[] = [];
  private specsPath: string;

  private static readonly MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
  private static readonly MAX_FILE_CHARS = 20000;
  private static readonly MAX_TOTAL_CHARS = 60000;

  private constructor() {
    if (!app.isReady()) {
      throw new Error('[SpecManager] Cannot initialize before app.whenReady()');
    }
    this.specsPath = path.join(app.getPath('userData'), 'specs.json');
    this.load();
  }

  public static getInstance(): SpecManager {
    if (!SpecManager.instance) {
      SpecManager.instance = new SpecManager();
    }
    return SpecManager.instance;
  }

  public list(): SpecDefinition[] {
    return [...this.specs];
  }

  public getById(id: string): SpecDefinition | undefined {
    return this.specs.find(spec => spec.id === id);
  }

  public save(spec: SpecDefinition): SpecDefinition {
    const now = new Date().toISOString();
    const existingIndex = this.specs.findIndex(s => s.id === spec.id);
    const normalized: SpecDefinition = {
      ...spec,
      name: spec.name?.trim() || 'Untitled Spec',
      prompt: spec.prompt || '',
      filePaths: Array.isArray(spec.filePaths) ? spec.filePaths : [],
      updatedAt: now,
      createdAt: spec.createdAt || now,
    };

    if (existingIndex >= 0) {
      this.specs[existingIndex] = normalized;
    } else {
      this.specs.push(normalized);
    }
    this.persist();
    return normalized;
  }

  public delete(id: string): boolean {
    const next = this.specs.filter(spec => spec.id !== id);
    const removed = next.length !== this.specs.length;
    this.specs = next;
    if (removed) this.persist();
    return removed;
  }

  public async buildSpecContext(id: string): Promise<{ name: string; context: string } | null> {
    const spec = this.getById(id);
    if (!spec) return null;

    const sections: string[] = [];

    const prompt = (spec.prompt || '').trim();
    if (prompt) {
      sections.push(`[SPEC PROMPT]\n${prompt}`);
    }

    if (spec.filePaths?.length) {
      const fileSections: string[] = [];
      let totalChars = 0;

      for (const filePath of spec.filePaths) {
        try {
          const { text, name } = await this.readFileAsText(filePath);
          if (!text) continue;

          const remaining = SpecManager.MAX_TOTAL_CHARS - totalChars;
          if (remaining <= 0) break;

          const clipped = text.slice(0, Math.min(text.length, remaining));
          totalChars += clipped.length;

          fileSections.push(`--- ${name} ---\n${clipped}`);
        } catch (error) {
          console.warn('[SpecManager] Failed to read spec file:', filePath, error);
        }
      }

      if (fileSections.length > 0) {
        sections.push(`[SPEC FILES]\n${fileSections.join('\n\n')}`);
      }
    }

    if (sections.length === 0) return null;

    return {
      name: spec.name,
      context: sections.join('\n\n')
    };
  }

  private async readFileAsText(filePath: string): Promise<{ text: string; name: string }> {
    const name = path.basename(filePath);
    const stat = await fs.promises.stat(filePath);
    if (stat.size > SpecManager.MAX_FILE_BYTES) {
      throw new Error(`File too large: ${name}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    let text = '';

    if (ext === '.txt' || ext === '.md') {
      text = await fs.promises.readFile(filePath, 'utf8');
    } else if (ext === '.pdf') {
      const buffer = await fs.promises.readFile(filePath);
      const parsed = await pdfParse(buffer);
      text = parsed.text || '';
    } else if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value || '';
    }

    text = text.replace(/\s+$/g, '').trim();
    if (text.length > SpecManager.MAX_FILE_CHARS) {
      text = text.slice(0, SpecManager.MAX_FILE_CHARS);
    }

    return { text, name };
  }

  private load(): void {
    try {
      if (fs.existsSync(this.specsPath)) {
        const raw = fs.readFileSync(this.specsPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.specs = parsed;
        }
      }
    } catch (error) {
      console.error('[SpecManager] Failed to load specs:', error);
      this.specs = [];
    }
  }

  private persist(): void {
    try {
      const tmpPath = `${this.specsPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.specs, null, 2));
      fs.renameSync(tmpPath, this.specsPath);
    } catch (error) {
      console.error('[SpecManager] Failed to save specs:', error);
    }
  }
}
