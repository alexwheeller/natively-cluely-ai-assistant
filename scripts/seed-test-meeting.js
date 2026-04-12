const { app } = require('electron');
const { DatabaseManager } = require('../dist-electron/electron/db/DatabaseManager');
const { SpecIndexManager } = require('../dist-electron/auditor/electron/spec/SpecIndexManager');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

const meetingId = process.env.MEETING_ID || `test-meeting-${randomUUID()}`;
const title = process.env.MEETING_TITLE || 'Test Meeting (Seeded)';
const now = Date.now();
const startTimeMs = now - 15 * 60 * 1000;
const durationMs = 15 * 60 * 1000;

const transcriptFile = process.env.TRANSCRIPT_FILE || process.argv[2];
const userDataPath = process.env.USER_DATA_PATH;
const specId = process.env.SPEC_ID;

function loadTranscriptLines(filePath) {
  if (!filePath) {
    throw new Error('TRANSCRIPT_FILE is required (or pass a path as the first argument).');
  }

  const resolvedPath = path.resolve(filePath);
  const raw = fs.readFileSync(resolvedPath, 'utf8');

  if (resolvedPath.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Transcript JSON must be an array of { speaker, text, timestamp } items.');
    }
    return parsed.map((item, index) => ({
      speaker: item.speaker || 'Speaker',
      text: item.text || '',
      timestamp: Number.isFinite(item.timestamp)
        ? item.timestamp
        : startTimeMs + (index + 1) * 30_000
    }));
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => {
    const match = line.match(/^\s*(.*?)\s*\[(\d+):(\d{2})\]\s*:\s*(.+)$/);
    if (match) {
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      const offsetMs = (minutes * 60 + seconds) * 1000;
      return {
        speaker: match[1] || 'Speaker',
        text: match[4] || '',
        timestamp: startTimeMs + offsetMs
      };
    }

    return {
      speaker: 'Speaker',
      text: line.trim(),
      timestamp: startTimeMs + (index + 1) * 30_000
    };
  });
}

async function seedMeeting() {
  if (userDataPath) {
    app.setPath('userData', path.resolve(userDataPath));
  }
  await app.whenReady();

  const transcriptLines = loadTranscriptLines(transcriptFile);

  const meeting = {
    id: meetingId,
    title,
    date: new Date(now).toISOString(),
    duration: '15 min',
    summary: 'Seeded meeting for testing transcript ingestion.',
    detailedSummary: {
      overview: 'Reviewed OPS-007 evidence requirements.',
      actionItems: ['Provide audit logs for the last two changes.'],
      keyPoints: ['Workflow system tracks each change.']
    },
    transcript: transcriptLines,
    source: 'manual',
    isProcessed: true
  };

  const db = DatabaseManager.getInstance();
  db.saveMeeting(meeting, startTimeMs, durationMs);
  SpecIndexManager.getInstance().setMeetingSpec(meetingId, specId);

  console.log(`[seed-test-meeting] Created meeting ${meetingId} with ${transcriptLines.length} transcript rows.`);
  console.log(`[seed-test-meeting] Attached spec ${specId} to meeting ${meetingId}.`);
  app.quit();
}

seedMeeting().catch((error) => {
  console.error('[seed-test-meeting] Failed to seed meeting:', error);
  app.quit();
});
