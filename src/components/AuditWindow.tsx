import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Sparkles } from 'lucide-react';
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
  validations?: Record<string, string>;
}

type AuditOutcome = 'skipped' | 'ok' | 'action' | 'ofi';

const AuditWindow: React.FC = () => {
  const isLight = useResolvedTheme() === 'light';
  const [data, setData] = useState<AuditData | null>(null);
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [notesByControl, setNotesByControl] = useState<Record<string, string>>({});
  const [outcomesByControl, setOutcomesByControl] = useState<Record<string, AuditOutcome | undefined>>({});
  const [validationByControl, setValidationByControl] = useState<Record<string, string>>({});
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportingOutcomes, setIsExportingOutcomes] = useState(false);
  const [exportOutcomesError, setExportOutcomesError] = useState<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const getControlsSignature = (controlsList: AuditControl[]) => {
    let hash = 5381;
    for (const control of controlsList) {
      for (let i = 0; i < control.controlId.length; i++) {
        hash = ((hash << 5) + hash) + control.controlId.charCodeAt(i);
        hash |= 0;
      }
    }
    return Math.abs(hash).toString(36);
  };

  const getSelectionStorageKey = (
    meetingId?: string | null,
    specId?: string | null,
    controlsSignature?: string | null
  ) => {
    if (!meetingId || !specId || !controlsSignature) return null;
    if (meetingId === 'live-meeting-current') return null;
    return `audit:selectedControl:${meetingId}:${specId}:${controlsSignature}`;
  };

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
          setValidationByControl(result.validations || {});
          setExportError(null);
          setExportOutcomesError(null);
          if (result.controls?.length) {
            const signature = getControlsSignature(result.controls);
            const storageKey = getSelectionStorageKey(result.meetingId, result.specId, signature);
            const storedSelection = storageKey ? window.localStorage.getItem(storageKey) : null;
            setSelectedControlId((prev) => {
              const preferred = storedSelection || prev;
              if (preferred && result.controls.some((control) => control.controlId === preferred)) {
                return preferred;
              }
              return result.controls[0].controlId;
            });
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

  useEffect(() => {
    const signature = data?.controls?.length ? getControlsSignature(data.controls) : null;
    const storageKey = getSelectionStorageKey(data?.meetingId, data?.specId, signature);
    if (!storageKey) return;
    if (selectedControlId) {
      window.localStorage.setItem(storageKey, selectedControlId);
    }
  }, [data?.meetingId, data?.specId, data?.controls, selectedControlId]);

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

  const handleValidate = async () => {
    if (!selectedControlId || !data?.meetingId) return;

    const controlId = selectedControlId;
    const prompt = `Are they meeting requirements for ${controlId}`;
    setValidationError(null);
    setIsValidating(true);
    setValidationByControl((prev) => ({
      ...prev,
      [controlId]: ''
    }));

    const meetingId = data.meetingId;
    let validationBuffer = '';

    const appendChunk = (chunk: string) => {
      validationBuffer += chunk;
      setValidationByControl((prev) => ({
        ...prev,
        [controlId]: `${prev[controlId] || ''}${chunk}`
      }));
    };

    let tokenCleanup: (() => void) | undefined;
    let doneCleanup: (() => void) | undefined;
    let errorCleanup: (() => void) | undefined;

    const cleanupAll = () => {
      tokenCleanup?.();
      doneCleanup?.();
      errorCleanup?.();
    };

    tokenCleanup = window.electronAPI?.onRAGStreamChunk((stream) => {
      appendChunk(stream.chunk);
    });

    doneCleanup = window.electronAPI?.onRAGStreamComplete(() => {
      setIsValidating(false);
      if (data?.specId) {
        window.electronAPI?.auditSaveValidation({
          meetingId,
          specId: data.specId,
          controlId,
          validation: validationBuffer
        });
      }
      cleanupAll();
    });

    errorCleanup = window.electronAPI?.onRAGStreamError((stream) => {
      setIsValidating(false);
      setValidationError(stream.error || 'Failed to validate.');
      cleanupAll();
    });

    try {
      await window.electronAPI?.ragQueryMeeting(meetingId, prompt);
    } catch (error) {
      setIsValidating(false);
      setValidationError('Failed to validate.');
      cleanupAll();
    }
  };

  const handleExportNotes = async () => {
    if (!data?.meetingId) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const result = await window.electronAPI.auditExportNotes({ meetingId: data.meetingId });
      if (!result.success && !result.cancelled) {
        setExportError(result.error || 'Failed to export notes.');
      }
    } catch (error) {
      setExportError('Failed to export notes.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportOutcomes = async () => {
    if (!data?.meetingId) return;
    setIsExportingOutcomes(true);
    setExportOutcomesError(null);
    try {
      const result = await window.electronAPI.auditExportOutcomes({ meetingId: data.meetingId });
      if (!result.success && !result.cancelled) {
        setExportOutcomesError(result.error || 'Failed to export outcomes.');
      }
    } catch (error) {
      setExportOutcomesError('Failed to export outcomes.');
    } finally {
      setIsExportingOutcomes(false);
    }
  };

  const selectedOutcome: AuditOutcome | undefined = selectedControlId
    ? outcomesByControl[selectedControlId]
    : undefined;

  const outcomeStyles: Record<AuditOutcome, { label: string; chip: string; border: string; accent: string }> = {
    skipped: {
      label: 'Skipped',
      chip: 'bg-bg-input/80 text-text-primary',
      border: 'border-border-strong',
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
      chip: 'bg-amber-500/25 text-amber-200',
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
          <div className="flex items-center gap-2 pr-1">
            {exportError && (
              <span className="text-[11px] text-red-400">{exportError}</span>
            )}
            {exportOutcomesError && (
              <span className="text-[11px] text-red-400">{exportOutcomesError}</span>
            )}
            <button
              onClick={handleExportNotes}
              disabled={!data?.specId || isExporting}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${isExporting
                ? 'text-text-tertiary border-white/10'
                : 'bg-bg-input border-border-strong text-text-primary hover:bg-bg-input/80'
                }`}
            >
              {isExporting ? 'Exporting...' : 'Export Notes'}
            </button>
            <button
              onClick={handleExportOutcomes}
              disabled={!data?.specId || isExportingOutcomes}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${isExportingOutcomes
                ? 'text-text-tertiary border-white/10'
                : 'bg-bg-input border-border-strong text-text-primary hover:bg-bg-input/80'
                }`}
            >
              {isExportingOutcomes ? 'Exporting...' : 'Export Outcomes'}
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <aside className="w-[204px] border-r border-border-subtle bg-bg-primary/60">
            <div className="h-full overflow-y-auto custom-scrollbar p-2 space-y-1.5">
              {controlList}
            </div>
          </aside>

          <div className="flex-1 flex min-h-0">
            <main className="flex-[2] flex flex-col min-h-0 border-r border-border-subtle">
              <section className="flex-1 border-b border-border-subtle px-3 pb-2 pt-3 min-h-0 bg-bg-primary/60">
                <div className="max-w-3xl h-full">
                  <div className="rounded-xl border border-border-subtle bg-bg-input overflow-hidden h-full flex flex-col">
                    <div className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-tertiary bg-bg-input/95 backdrop-blur">
                      Requirements
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-4 text-sm leading-relaxed text-text-primary whitespace-pre-wrap">
                      {selectedControl?.requirements || 'Select a control to view requirements.'}
                    </div>
                  </div>
                </div>
              </section>

              <section className="flex-none h-[32vh] min-h-[180px] max-h-[260px] px-3 pt-3 pb-2 bg-bg-primary/60 flex flex-col">
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
                        className={`px-3 py-2 rounded-lg text-[11px] font-semibold transition-colors border bg-bg-input ${isActive
                          ? `${style.border} ${style.chip}`
                          : 'border-border-subtle text-text-secondary hover:text-text-primary'
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

            <aside className="flex-1 min-w-[204px] bg-bg-primary/50 flex flex-col">
              <div className="flex items-center justify-between px-2 py-2 border-b border-border-subtle">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
                  Validation
                </div>
                <button
                  onClick={handleValidate}
                  disabled={!selectedControlId || isValidating}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press overlay-text-interactive disabled:opacity-60 disabled:cursor-not-allowed ${isValidating ? 'text-text-tertiary border-white/10' : 'bg-purple-500/20 border-purple-400/40 text-purple-200 hover:bg-purple-500/30'}`}
                >
                  <Sparkles size={12} className="opacity-80" />
                  {isValidating ? 'Validating...' : 'Validate'}
                </button>
              </div>
                <div className="flex-1 px-2 py-2 flex flex-col gap-2 overflow-hidden">
                {validationError && (
                  <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    {validationError}
                  </div>
                )}
                <textarea
                  readOnly
                  value={selectedControlId ? (validationByControl[selectedControlId] || '') : ''}
                  className="w-full flex-1 resize-none rounded-xl bg-bg-input border border-border-subtle px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
                  placeholder="Validation output will appear here..."
                />
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuditWindow;
