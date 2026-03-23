import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export class AuditManager {
  private static instance: AuditManager;
  private db: Database.Database | null = null;
  private dbPath: string;

  private constructor() {
    if (!app.isReady()) {
      throw new Error('[AuditManager] Cannot initialize before app.whenReady()');
    }
    const userDataPath = app.getPath('userData');
    this.dbPath = path.join(userDataPath, 'audit.db');
    this.init();
  }

  public static getInstance(): AuditManager {
    if (!AuditManager.instance) {
      AuditManager.instance = new AuditManager();
    }
    return AuditManager.instance;
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
      CREATE TABLE IF NOT EXISTS audit_notes (
        meeting_id TEXT NOT NULL,
        spec_id TEXT NOT NULL,
        control_id TEXT NOT NULL,
        notes TEXT NOT NULL,
        outcome TEXT DEFAULT NULL,
        outcome_set INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (meeting_id, control_id)
      );

      CREATE INDEX IF NOT EXISTS idx_audit_notes_meeting ON audit_notes(meeting_id);
      CREATE INDEX IF NOT EXISTS idx_audit_notes_spec ON audit_notes(spec_id);
    `);

    const columns = this.db.prepare('PRAGMA table_info(audit_notes)').all() as Array<{ name: string }>;
    const hasOutcome = columns.some((col) => col.name === 'outcome');
    if (!hasOutcome) {
      this.db.exec("ALTER TABLE audit_notes ADD COLUMN outcome TEXT DEFAULT NULL");
    }

    const hasOutcomeSet = columns.some((col) => col.name === 'outcome_set');
    if (!hasOutcomeSet) {
      this.db.exec('ALTER TABLE audit_notes ADD COLUMN outcome_set INTEGER DEFAULT 0');
    }
  }

  public getAuditNotes(meetingId: string): Record<string, string> {
    if (!this.db) return {};
    try {
      const rows = this.db.prepare('SELECT control_id, notes FROM audit_notes WHERE meeting_id = ?').all(meetingId) as any[];
      const result: Record<string, string> = {};
      for (const row of rows) {
        if (row?.control_id) result[row.control_id] = row.notes || '';
      }
      return result;
    } catch (error) {
      console.error(`[AuditManager] Failed to fetch audit notes for meeting ${meetingId}:`, error);
      return {};
    }
  }

  public getAuditOutcomes(meetingId: string): Record<string, string> {
    if (!this.db) return {};
    try {
      const rows = this.db.prepare(
        'SELECT control_id, outcome FROM audit_notes WHERE meeting_id = ? AND outcome_set = 1'
      ).all(meetingId) as any[];
      const result: Record<string, string> = {};
      for (const row of rows) {
        if (row?.control_id && row.outcome) result[row.control_id] = row.outcome;
      }
      return result;
    } catch (error) {
      console.error(`[AuditManager] Failed to fetch audit outcomes for meeting ${meetingId}:`, error);
      return {};
    }
  }

  public saveAuditNote(meetingId: string, specId: string, controlId: string, notes: string): boolean {
    if (!this.db) return false;
    try {
      const now = new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT INTO audit_notes (meeting_id, spec_id, control_id, notes, outcome, outcome_set, created_at, updated_at)
        VALUES (?, ?, ?, ?, NULL, 0, ?, ?)
        ON CONFLICT(meeting_id, control_id)
        DO UPDATE SET notes = excluded.notes, spec_id = excluded.spec_id, updated_at = excluded.updated_at
      `);
      const info = stmt.run(meetingId, specId, controlId, notes, now, now);
      return info.changes > 0;
    } catch (error) {
      console.error(`[AuditManager] Failed to save audit note for meeting ${meetingId}:`, error);
      return false;
    }
  }

  public saveAuditOutcome(meetingId: string, specId: string, controlId: string, outcome: string): boolean {
    if (!this.db) return false;
    try {
      const now = new Date().toISOString();
      const stmt = this.db.prepare(`
        INSERT INTO audit_notes (meeting_id, spec_id, control_id, notes, outcome, outcome_set, created_at, updated_at)
        VALUES (?, ?, ?, '', ?, 1, ?, ?)
        ON CONFLICT(meeting_id, control_id)
        DO UPDATE SET outcome = excluded.outcome, outcome_set = 1, spec_id = excluded.spec_id, updated_at = excluded.updated_at
      `);
      const info = stmt.run(meetingId, specId, controlId, outcome, now, now);
      return info.changes > 0;
    } catch (error) {
      console.error(`[AuditManager] Failed to save audit outcome for meeting ${meetingId}:`, error);
      return false;
    }
  }

  public migrateAuditNotes(fromMeetingId: string, toMeetingId: string): void {
    if (!this.db) return;
    try {
      const rows = this.db.prepare(
        'SELECT control_id, spec_id, notes, outcome, outcome_set, created_at, updated_at FROM audit_notes WHERE meeting_id = ?'
      ).all(fromMeetingId) as any[];
      if (rows.length === 0) return;

      const insert = this.db.prepare(`
        INSERT INTO audit_notes (meeting_id, spec_id, control_id, notes, outcome, outcome_set, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(meeting_id, control_id)
        DO UPDATE SET notes = excluded.notes, outcome = excluded.outcome, outcome_set = excluded.outcome_set, spec_id = excluded.spec_id, updated_at = excluded.updated_at
      `);
      const del = this.db.prepare('DELETE FROM audit_notes WHERE meeting_id = ?');

      const runTx = this.db.transaction(() => {
        for (const row of rows) {
          insert.run(
            toMeetingId,
            row.spec_id,
            row.control_id,
            row.notes,
            row.outcome || null,
            row.outcome_set ? 1 : 0,
            row.created_at,
            row.updated_at
          );
        }
        del.run(fromMeetingId);
      });

      runTx();
    } catch (error) {
      console.error(`[AuditManager] Failed to migrate audit notes from ${fromMeetingId} to ${toMeetingId}:`, error);
    }
  }
}
