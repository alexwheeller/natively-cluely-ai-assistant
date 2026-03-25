import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { chunkDocument } from '../rag/SemanticChunker';
import { estimateTokens } from '../rag/TranscriptPreprocessor';
import { SpecManager } from '../services/SpecManager';

export interface SpecChunkRow {
  id: number;
  specId: string;
  chunkIndex: number;
  text: string;
  tokenCount: number;
}

export interface SpecContextResult {
  chunks: SpecChunkRow[];
  formattedContext: string;
  totalTokens: number;
}


export class SpecIndexManager {
  private static instance: SpecIndexManager;
  private db: Database.Database | null = null;
  private dbPath: string;

  private constructor() {
    if (!app.isReady()) {
      throw new Error('[SpecIndexManager] Cannot initialize before app.whenReady()');
    }
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'spec_index.db');
    this.init();
  }

  public static getInstance(): SpecIndexManager {
    if (!SpecIndexManager.instance) {
      SpecIndexManager.instance = new SpecIndexManager();
    }
    return SpecIndexManager.instance;
  }

  private init(): void {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.runMigrations();
  }

  private runMigrations(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spec_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spec_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        embedding BLOB,
        embedding_provider TEXT,
        embedding_dimensions INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_spec_chunks_spec ON spec_chunks(spec_id);

      CREATE TABLE IF NOT EXISTS meeting_specs (
        meeting_id TEXT PRIMARY KEY,
        spec_id TEXT NOT NULL,
        spec_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  public getMeetingSpecId(meetingId: string): string | null {
    if (!this.db) return null;
    try {
      const row = this.db.prepare('SELECT spec_id FROM meeting_specs WHERE meeting_id = ?').get(meetingId) as any;
      return row?.spec_id || null;
    } catch (error) {
      console.error('[SpecIndexManager] Failed to read meeting spec mapping:', error);
      return null;
    }
  }

  public getMeetingSpecInfo(meetingId: string): { specId: string; specName: string | null } | null {
    if (!this.db) return null;
    try {
      const row = this.db.prepare('SELECT spec_id, spec_name FROM meeting_specs WHERE meeting_id = ?').get(meetingId) as any;
      if (!row?.spec_id) return null;
      if (row.spec_name) {
        return { specId: row.spec_id, specName: row.spec_name };
      }
      const spec = SpecManager.getInstance().getById(row.spec_id);
      return { specId: row.spec_id, specName: spec?.name || null };
    } catch (error) {
      console.error('[SpecIndexManager] Failed to read meeting spec info:', error);
      return null;
    }
  }

  public setMeetingSpec(meetingId: string, specId: string, specName?: string): void {
    if (!this.db) return;
    try {
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT OR REPLACE INTO meeting_specs (meeting_id, spec_id, spec_name, created_at, updated_at)
        VALUES (
          ?,
          ?,
          ?,
          COALESCE((SELECT created_at FROM meeting_specs WHERE meeting_id = ?), ?),
          ?
        )
      `).run(meetingId, specId, specName || null, meetingId, now, now);
    } catch (error) {
      console.error('[SpecIndexManager] Failed to save meeting spec mapping:', error);
    }
  }

  public clearMeetingSpec(meetingId: string): void {
    if (!this.db) return;
    try {
      this.db.prepare('DELETE FROM meeting_specs WHERE meeting_id = ?').run(meetingId);
    } catch (error) {
      console.error('[SpecIndexManager] Failed to clear meeting spec mapping:', error);
    }
  }

  public deleteSpec(specId: string): void {
    if (!this.db) return;
    try {
      this.db.prepare('DELETE FROM spec_chunks WHERE spec_id = ?').run(specId);
      this.db.prepare('DELETE FROM meeting_specs WHERE spec_id = ?').run(specId);
    } catch (error) {
      console.error('[SpecIndexManager] Failed to delete spec index:', error);
    }
  }

  public async indexSpec(
    specId: string,
    options: {
      getEmbedding?: (text: string) => Promise<number[]>;
      providerName?: string;
    } = {}
  ): Promise<{ chunkCount: number }> {
    if (!this.db) return { chunkCount: 0 };

    const specContext = await SpecManager.getInstance().buildSpecContext(specId);
    if (!specContext?.context) {
      this.deleteSpec(specId);
      return { chunkCount: 0 };
    }

    const chunks = chunkDocument(specId, specContext.context, { speaker: 'SPEC' });
    if (chunks.length === 0) {
      this.deleteSpec(specId);
      return { chunkCount: 0 };
    }

    const insert = this.db.prepare(`
      INSERT INTO spec_chunks (spec_id, chunk_index, text, token_count, embedding, embedding_provider, embedding_dimensions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const clear = this.db.prepare('DELETE FROM spec_chunks WHERE spec_id = ?');

    const rows: Array<{ id: number; text: string }> = [];

    const runTx = this.db.transaction(() => {
      clear.run(specId);
      for (const chunk of chunks) {
        const result = insert.run(
          specId,
          chunk.chunkIndex,
          chunk.text,
          chunk.tokenCount,
          null,
          options.providerName || null,
          null
        );
        rows.push({ id: result.lastInsertRowid as number, text: chunk.text });
      }
    });

    runTx();

    if (options.getEmbedding) {
      for (const row of rows) {
        try {
          const embedding = await options.getEmbedding(row.text);
          const blob = this.embeddingToBlob(embedding);
          this.db.prepare(
            'UPDATE spec_chunks SET embedding = ?, embedding_dimensions = ? WHERE id = ?'
          ).run(blob, embedding.length, row.id);
        } catch (error) {
          console.warn('[SpecIndexManager] Failed to embed spec chunk:', error);
        }
      }
    }

    return { chunkCount: rows.length };
  }


  public getContextForQuery(specId: string, query: string, maxTokens: number = 1500): SpecContextResult | null {
    if (!this.db) return null;
    const controlIds = this.extractControlIds(query);
    const rawChunks = new Map<number, SpecChunkRow>();

    if (controlIds.length > 0) {
      const uniqueIds = Array.from(new Set(controlIds));

      for (const controlId of uniqueIds) {
        const like = `%${controlId}%`;
        const rows = this.db.prepare(
          'SELECT id, spec_id, chunk_index, text, token_count FROM spec_chunks WHERE spec_id = ? AND text LIKE ?'
        ).all(specId, like) as any[];

        const matcher = this.buildExactIdMatcher(controlId);
        for (const row of rows) {
          if (!matcher.test(row.text)) continue;

          const lines = row.text
            .split(/\r?\n/)
            .map((line: string) => line.trim())
            .filter((line: string) => line.length > 0);

          let matchedText = row.text;
          for (let i = 0; i < lines.length; i++) {
            if (!matcher.test(lines[i])) continue;

            const collected: string[] = [lines[i]];
            for (let j = i + 1; j < lines.length; j++) {
              if (/^\s*(control\s*id|id)\s*[:#]/i.test(lines[j])) break;
              collected.push(lines[j]);
            }
            matchedText = collected.join('\n');
            break;
          }

          rawChunks.set(row.id, {
            id: row.id,
            specId: row.spec_id,
            chunkIndex: row.chunk_index,
            text: matchedText,
            tokenCount: estimateTokens(matchedText)
          });
        }
      }
    }

    if (rawChunks.size === 0) {
      const termMatches = this.findChunksByQueryTerms(specId, query);
      for (const chunk of termMatches) {
        rawChunks.set(chunk.id, chunk);
      }
    }

    if (rawChunks.size === 0) return null;

    const chunks = Array.from(rawChunks.values()).sort((a, b) => a.chunkIndex - b.chunkIndex);
    const selected: SpecChunkRow[] = [];
    let totalTokens = 0;

    for (const chunk of chunks) {
      if (totalTokens + chunk.tokenCount > maxTokens && selected.length > 0) break;
      selected.push(chunk);
      totalTokens += chunk.tokenCount;
    }

    if (selected.length === 0) return null;

    const formattedContext = selected
      .map(chunk => `${chunk.text}`)
      .join('\n\n');

    return {
      chunks: selected,
      formattedContext,
      totalTokens
    };
  }

  public extractControlIdsFromQuery(text: string): string[] {
    return this.extractControlIds(text);
  }

  private findChunksByQueryTerms(specId: string, query: string): SpecChunkRow[] {
    if (!this.db) return [];
    const terms = this.extractQueryTerms(query);
    if (terms.length === 0) return [];

    const likeClauses = terms.map(() => 'text LIKE ?').join(' OR ');
    const sql = `SELECT id, spec_id, chunk_index, text, token_count FROM spec_chunks WHERE spec_id = ? AND (${likeClauses})`;
    const params = [specId, ...terms.map(term => `%${term}%`)];
    const rows = this.db.prepare(sql).all(...params) as any[];
    if (rows.length === 0) return [];

    const scored = rows.map((row) => {
      const score = this.scoreChunkText(row.text, terms);
      return { row, score };
    }).filter((item) => item.score > 0);

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.row.chunk_index - b.row.chunk_index;
    });

    return scored.map((item) => ({
      id: item.row.id,
      specId: item.row.spec_id,
      chunkIndex: item.row.chunk_index,
      text: item.row.text,
      tokenCount: item.row.token_count
    }));
  }

  private extractQueryTerms(query: string): string[] {
    const cleaned = query
      .toLowerCase()
      .replace(/[^a-z0-9\s._-]/g, ' ');
    const rawTerms = cleaned.split(/\s+/).filter(Boolean);
    const stopwords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'what', 'which', 'your', 'you', 'are', 'was', 'were', 'can', 'could', 'should', 'would', 'shall', 'will', 'not', 'but', 'about', 'how', 'why', 'our', 'their', 'them', 'they', 'its', 'any', 'all', 'does', 'did', 'have', 'has', 'had']);
    const terms = rawTerms.filter((term) => term.length >= 3 && !stopwords.has(term));
    return Array.from(new Set(terms));
  }

  private scoreChunkText(text: string, terms: string[]): number {
    const lower = text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      let index = 0;
      while (true) {
        index = lower.indexOf(term, index);
        if (index === -1) break;
        score += 1;
        index += term.length;
      }
    }
    return score;
  }

  private extractControlIds(text: string): string[] {
    const ids = new Set<string>();
    const labelRegex = /(?:control\s*id|id)\s*[:#]\s*([A-Za-z0-9._-]{2,})/gi;
    const dashedRegex = /\b[A-Z]+-\d+\b/g;
    const dottedRegex = /\b[A-Za-z]\.\d+\.\d+\b/g;

    for (const match of text.matchAll(labelRegex)) {
      if (match[1]) ids.add(match[1]);
    }

    for (const match of text.matchAll(dashedRegex)) {
      ids.add(match[0]);
    }

    for (const match of text.matchAll(dottedRegex)) {
      ids.add(match[0]);
    }

    return Array.from(ids);
  }

  private buildExactIdMatcher(controlId: string): RegExp {
    const escaped = controlId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=[^A-Za-z0-9_]|$)`);
  }

  private embeddingToBlob(embedding: number[]): Buffer {
    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }
    return buffer;
  }
}
