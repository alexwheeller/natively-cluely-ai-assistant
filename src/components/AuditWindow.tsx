import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { isMac } from '../utils/platformUtils';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

interface AuditControl {
  controlId: string;
  requirements: string;
  shortDescription: string;
}

interface AuditData {
  meetingId: string;
  meetingTitle?: string | null;
  specId: string | null;
  specName: string | null;
  controls: AuditControl[];
  notes: Record<string, string>;
  outcomes: Record<string, string>;
}

type AuditOutcome = 'skipped' | 'ok' | 'action' | 'ofi';

const AuditWindow: React.FC = () => {
  const isLight = useResolvedTheme() === 'light';
  const [data, setData] = useState<AuditData | null>(null);
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [notesByControl, setNotesByControl] = useState<Record<string, string>>({});
  const [outcomesByControl, setOutcomesByControl] = useState<Record<string, AuditOutcome | undefined>>({});
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadAuditData = () => {
      const params = new URLSearchParams(window.location.search);
      const meetingId = params.get('meetingId') || undefined;

      window.electronAPI.auditGetData(meetingId ? { meetingId } : undefined)
        .then((result) => {
          if (!mounted) return;
          setData(result);
          setNotesByControl(result.notes || {});
          setOutcomesByControl((result.outcomes || {}) as Record<string, AuditOutcome | undefined>);
          if (result.controls?.length) {
            setSelectedControlId(result.controls[0].controlId);
          }
        })
        .catch(() => {
          if (!mounted) return;
          setData({ meetingId: meetingId || 'live-meeting-current', meetingTitle: null, specId: null, specName: null, controls: [], notes: {}, outcomes: {} });
        });
    };

    loadAuditData();
    window.addEventListener('focus', loadAuditData);

    return () => {
      mounted = false;
      window.removeEventListener('focus', loadAuditData);
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, []);

  const controls = data?.controls || [];

  useEffect(() => {
    if (!selectedControlId && controls.length > 0) {
      setSelectedControlId(controls[0].controlId);
    }
  }, [controls, selectedControlId]);

  const selectedControl = useMemo(() => {
    if (!selectedControlId) return null;
    return controls.find((control) => control.controlId === selectedControlId) || null;
  }, [controls, selectedControlId]);

  const handleNotesChange = (value: string) => {
    if (!selectedControlId) return;

    setNotesByControl((prev) => ({
      ...prev,
      [selectedControlId]: value
    }));

    if (!data?.meetingId || !data.specId) return;

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      window.electronAPI.auditSaveNote({
        meetingId: data.meetingId,
        specId: data.specId as string,
        controlId: selectedControlId,
        notes: value
      });
    }, 500);
  };

  const handleOutcomeChange = (outcome: AuditOutcome) => {
    if (!selectedControlId) return;

    setOutcomesByControl((prev) => ({
      ...prev,
      [selectedControlId]: outcome
    }));

    if (!data?.meetingId || !data.specId) return;

    window.electronAPI.auditSaveOutcome({
      meetingId: data.meetingId,
      specId: data.specId as string,
      controlId: selectedControlId,
      outcome
    });
  };

  const selectedOutcome: AuditOutcome | undefined = selectedControlId
    ? outcomesByControl[selectedControlId]
    : undefined;

  const outcomeStyles: Record<AuditOutcome, { label: string; chip: string; border: string; accent: string }> = {
    skipped: {
      label: 'Skipped',
      chip: 'bg-bg-input text-text-tertiary',
      border: 'border-border-subtle',
      accent: 'bg-text-tertiary'
    },
    ok: {
      label: 'OK',
      chip: 'bg-emerald-500/15 text-emerald-300',
      border: 'border-emerald-500/40',
      accent: 'bg-emerald-400'
    },
    action: {
      label: 'Action',
      chip: 'bg-red-500/15 text-red-300',
      border: 'border-red-500/40',
      accent: 'bg-red-400'
    },
    ofi: {
      label: 'OFI',
      chip: 'bg-amber-500/15 text-amber-300',
      border: 'border-amber-500/40',
      accent: 'bg-amber-400'
    }
  };

  const controlList = controls.length > 0 ? (
    controls.map((control) => {
      const isActive = control.controlId === selectedControlId;
      const outcome = outcomesByControl[control.controlId];
      const outcomeStyle = outcome ? outcomeStyles[outcome] : null;
      return (
        <button
          key={control.controlId}
          onClick={() => setSelectedControlId(control.controlId)}
          className={`w-full text-left px-3 py-2 rounded-lg transition-colors border ${isActive
              ? 'bg-bg-input border-border-strong text-text-primary'
              : 'bg-transparent border-transparent text-text-secondary hover:bg-bg-input hover:text-text-primary'
            }`}
        >
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${outcomeStyle ? outcomeStyle.accent : 'bg-transparent opacity-0'}`} />
            <span className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">
              {control.controlId}
            </span>
          </div>
          <div className="text-xs leading-snug line-clamp-2 text-text-secondary">
            {control.shortDescription || 'No description'}
          </div>
        </button>
      );
    })
  ) : (
    <div className="text-xs text-text-tertiary px-3 py-2">No controls found.</div>
  );

  return (
    <div className="h-screen w-screen bg-bg-secondary text-text-primary font-sans">
      <div className="h-full flex flex-col">
        <header className="relative h-[56px] shrink-0 flex items-center justify-between pl-0 pr-2 drag-region select-none border-b border-border-subtle bg-bg-elevated">
          <div className="flex items-center gap-3">
            {isMac && <div className="w-[70px]" />}
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-bg-input border border-border-muted">
              <FileText size={16} className={isLight ? 'text-slate-600' : 'text-text-primary'} />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">{data?.meetingTitle || 'Audit'}</span>
              <span className="text-xs text-text-tertiary">
                {data?.specName || data?.specId || 'No spec attached'}
              </span>
            </div>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <aside className="w-[260px] border-r border-border-subtle bg-bg-primary/60">
            <div className="h-full overflow-y-auto custom-scrollbar p-3 space-y-2">
              {controlList}
            </div>
          </aside>

          <main className="flex-1 flex flex-col min-h-0">
            <section className="flex-1 border-b border-border-subtle p-6 overflow-y-auto custom-scrollbar min-h-0">
              <div className="max-w-3xl">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">
                  Requirements
                </div>
                <div className="text-sm leading-relaxed text-text-primary whitespace-pre-wrap">
                  {selectedControl?.requirements || 'Select a control to view requirements.'}
                </div>
              </div>
            </section>

            <section className="flex-none h-[32vh] min-h-[180px] max-h-[260px] p-6 bg-bg-primary/60 flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                  Outcome
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {(Object.keys(outcomeStyles) as AuditOutcome[]).map((outcome) => {
                  const style = outcomeStyles[outcome];
                  const isActive = selectedOutcome === outcome;
                  return (
                    <button
                      key={outcome}
                      onClick={() => handleOutcomeChange(outcome)}
                      className={`px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors border ${isActive
                        ? `${style.border} ${style.chip}`
                        : 'border-border-subtle text-text-secondary hover:text-text-primary hover:bg-bg-input'
                        }`}
                    >
                      {style.label}
                    </button>
                  );
                })}
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">
                Auditor Notes
              </div>
              <textarea
                value={selectedControlId ? (notesByControl[selectedControlId] || '') : ''}
                onChange={(e) => handleNotesChange(e.target.value)}
                className="w-full flex-1 resize-none rounded-xl bg-bg-input border border-border-subtle px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-400/40"
                placeholder="Capture findings, evidence, and follow-ups..."
              />
            </section>
          </main>
        </div>
      </div>
    </div>
  );
};

export default AuditWindow;
