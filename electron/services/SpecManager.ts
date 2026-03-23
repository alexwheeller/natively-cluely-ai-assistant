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

export interface AuditControl {
  controlId: string;
  requirements: string;
  shortDescription: string;
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

  public async getAuditControls(specId: string): Promise<AuditControl[]> {
    const spec = this.getById(specId);
    if (!spec?.filePaths?.length) return [];

    const controls: AuditControl[] = [];

    for (const filePath of spec.filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext !== '.csv') continue;

      try {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        const parsed = this.parseAuditControlsFromCsv(raw);
        if (parsed.length > 0) controls.push(...parsed);
      } catch (error) {
        console.warn('[SpecManager] Failed to read audit CSV:', filePath, error);
      }
    }

    return controls;
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
    } else if (ext === '.csv') {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      text = this.csvToText(raw);
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

  private csvToText(raw: string): string {
    const rows = this.parseCsv(raw);
    if (rows.length === 0) return '';

    const headers = rows[0].map(h => h.trim());
    const dataRows = rows.slice(1).filter(row => row.some(cell => cell.trim().length > 0));

    const formattedRows: string[] = [];
    for (const row of dataRows) {
      const parts: string[] = [];
      for (let i = 0; i < headers.length; i++) {
        const header = headers[i] || `Column${i + 1}`;
        const value = (row[i] || '').replace(/\s+/g, ' ').trim();
        parts.push(`${header}: ${value}`);
      }
      formattedRows.push(parts.join(' | '));
    }

    return formattedRows.join('\n');
  }

  private parseAuditControlsFromCsv(raw: string): AuditControl[] {
    const rows = this.parseCsv(raw);
    if (rows.length === 0) return [];

    const headers = rows[0].map(h => h.trim());
    const dataRows = rows.slice(1).filter(row => row.some(cell => cell.trim().length > 0));

    const controlIdIndexRaw = this.findHeaderIndex(headers, [
      'control id',
      'control_id',
      'control',
      'id'
    ], true);

    const controlIdIndex = controlIdIndexRaw >= 0 ? controlIdIndexRaw : 0;

    const requirementIndex = this.findHeaderIndex(headers, [
      'requirement',
      'requirements',
      'control requirement',
      'description',
      'details',
      'summary'
    ], false);

    const fallbackRequirementIndex = headers.findIndex((_, idx) => idx !== controlIdIndex);
    const reqIndex = requirementIndex >= 0 ? requirementIndex : fallbackRequirementIndex;

    const controls: AuditControl[] = [];
    for (const row of dataRows) {
      const controlId = (row[controlIdIndex] || '').replace(/\r?\n/g, ' ').trim();
      if (!controlId) continue;

      const requirements = (row[reqIndex] || '')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const shortDescription = this.firstSentence(requirements) || 'No description available.';

      controls.push({
        controlId,
        requirements,
        shortDescription
      });
    }

    return controls;
  }

  private findHeaderIndex(headers: string[], needles: string[], strictControlId: boolean): number {
    const normalized = headers.map(h => h.toLowerCase().replace(/\s+/g, ' ').trim());

    for (let i = 0; i < normalized.length; i++) {
      const value = normalized[i];
      if (strictControlId) {
        if (value.includes('control') && value.includes('id')) return i;
        if (value === 'id') return i;
        if (value === 'control') return i;
      } else {
        for (const needle of needles) {
          if (value.includes(needle)) return i;
        }
      }
    }

    return -1;
  }

  private firstSentence(text: string): string {
    if (!text) return '';
    const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
    return (match ? match[0] : text).trim();
  }

  private parseCsv(raw: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = '';
    let inQuotes = false;

    const pushValue = () => {
      row.push(value);
      value = '';
    };

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];

      if (inQuotes) {
        if (ch === '"') {
          const next = raw[i + 1];
          if (next === '"') {
            value += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          value += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        continue;
      }

      if (ch === ',') {
        pushValue();
        continue;
      }

      if (ch === '\n') {
        pushValue();
        rows.push(row);
        row = [];
        continue;
      }

      if (ch === '\r') {
        // Ignore CR in CRLF sequences
        continue;
      }

      value += ch;
    }

    pushValue();
    if (row.length > 1 || row[0]?.trim().length) {
      rows.push(row);
    }

    return rows;
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
