import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

interface AuditControl {
  controlId: string;
  requirements: string;
  shortDescription: string;
}

interface AuditData {
  meetingId: string;
  specId: string | null;
  specName: string | null;
  controls: AuditControl[];
  notes: Record<string, string>;
}

const AuditWindow: React.FC = () => {
  const isLight = useResolvedTheme() === 'light';
  const [data, setData] = useState<AuditData | null>(null);
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [notesByControl, setNotesByControl] = useState<Record<string, string>>({});
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;

    window.electronAPI.auditGetData()
      .then((result) => {
        if (!mounted) return;
        setData(result);
        setNotesByControl(result.notes || {});
        if (result.controls?.length) {
          setSelectedControlId(result.controls[0].controlId);
        }
      })
      .catch(() => {
        if (!mounted) return;
        setData({ meetingId: 'live-meeting-current', specId: null, specName: null, controls: [], notes: {} });
      });

    return () => {
      mounted = false;
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

  const controlList = controls.length > 0 ? (
    controls.map((control) => {
      const isActive = control.controlId === selectedControlId;
      return (
        <button
          key={control.controlId}
          onClick={() => setSelectedControlId(control.controlId)}
          className={`w-full text-left px-3 py-2 rounded-lg transition-colors border ${isActive
              ? 'bg-bg-input border-border-strong text-text-primary'
              : 'bg-transparent border-transparent text-text-secondary hover:bg-bg-input hover:text-text-primary'
            }`}
        >
          <div className="text-[11px] font-semibold tracking-wide uppercase text-text-tertiary">
            {control.controlId}
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
        <header className="h-[56px] px-6 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-bg-input border border-border-muted">
              <FileText size={16} className={isLight ? 'text-slate-600' : 'text-text-primary'} />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Audit</span>
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

          <main className="flex-1 flex flex-col">
            <section className="flex-1 border-b border-border-subtle p-6 overflow-y-auto custom-scrollbar">
              <div className="max-w-3xl">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">
                  Requirements
                </div>
                <div className="text-sm leading-relaxed text-text-primary whitespace-pre-wrap">
                  {selectedControl?.requirements || 'Select a control to view requirements.'}
                </div>
              </div>
            </section>

            <section className="h-[240px] p-6 bg-bg-primary/60">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-2">
                Auditor Notes
              </div>
              <textarea
                value={selectedControlId ? (notesByControl[selectedControlId] || '') : ''}
                onChange={(e) => handleNotesChange(e.target.value)}
                className="w-full h-[160px] resize-none rounded-xl bg-bg-input border border-border-subtle px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-400/40"
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
