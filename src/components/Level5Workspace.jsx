import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
import { CheckCircle, Database, FileText, Heart, Loader2, Upload, Users } from 'lucide-react';
import { datasetService, ecgService } from '../lib/supabase';
import {
  level5AnnotationService,
  level5AssignmentService,
  level5DatasetVersionService,
  level5ProtocolService,
  level5SourceService
} from '../lib/level5';

const LEAD_NAMES = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
const SESSION_TYPES = ['primary', 'secondary', 'review', 'adjudication', 'ai_preannotation'];
const SOURCE_KINDS = ['csv', 'wfdb', 'dicom', 'scp_ecg', 'xml', 'pdf', 'image', 'vendor_binary', 'derived_artifact'];
const SPLIT_OPTIONS = ['train', 'validation', 'test', 'external', 'unassigned'];
const SPLIT_STRATEGIES = ['patient_level', 'site_level', 'temporal', 'external_only', 'none'];

const emptyBeatForm = { sampleIndex: '', leadName: 'II', beatType: 'normal', confidence: '1' };
const emptyWaveForm = {
  leadName: 'II',
  beatSample: '',
  pOnset: '',
  pPeak: '',
  pOffset: '',
  qrsOnset: '',
  qPeak: '',
  rPeak: '',
  sPeak: '',
  qrsOffset: '',
  jPoint: '',
  tOnset: '',
  tPeak: '',
  tOffset: '',
  confidence: '1'
};
const emptyRhythmForm = { startSample: '', endSample: '', rhythmCode: 'SINUS_RHYTHM', leadName: '', confidence: '1' };
const emptyMeasurementForm = {
  measurementCode: 'HEART_RATE',
  value: '',
  unit: 'bpm',
  leadName: '',
  startSample: '',
  endSample: '',
  method: '',
  confidence: '1'
};
const emptyDiagnosisForm = {
  termId: '',
  displayText: '',
  certainty: 'definite',
  confidence: '1',
  leadNames: '',
  startSample: '',
  endSample: ''
};
const emptySourceForm = {
  sourceKind: 'csv',
  originalFilename: '',
  mediaType: '',
  samplingRateHz: '',
  amplitudeUnit: 'mV',
  leadNames: LEAD_NAMES.join(', '),
  isOriginal: true
};
const emptyVersionForm = {
  version: '',
  description: '',
  protocolId: '',
  splitStrategy: 'patient_level',
  splitSeed: ''
};
const emptyVersionRecordForm = {
  versionId: '',
  groundTruthSessionId: '',
  split: 'train'
};

const parseNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseInteger = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseList = (value) => (
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

const displayTime = (value) => (value ? new Date(value).toLocaleString() : '—');
const getVersionRecordCount = (version) => version.records?.[0]?.count ?? version.records?.count ?? 0;

const FormSection = ({ title, children }) => (
  <div className="bg-white rounded-lg shadow p-5">
    <h3 className="font-semibold text-gray-800 mb-4">{title}</h3>
    <div className="space-y-3">{children}</div>
  </div>
);

export default function Level5Workspace({ currentUser, onBack }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [datasets, setDatasets] = useState([]);
  const [records, setRecords] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [protocols, setProtocols] = useState([]);
  const [diagnosisTerms, setDiagnosisTerms] = useState([]);
  const [datasetVersions, setDatasetVersions] = useState([]);
  const [recordSessions, setRecordSessions] = useState([]);
  const [recordSources, setRecordSources] = useState([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState('');
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [selectedProtocolId, setSelectedProtocolId] = useState('');
  const [selectedSessionType, setSelectedSessionType] = useState('primary');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [currentBundle, setCurrentBundle] = useState(null);
  const [beatForm, setBeatForm] = useState(emptyBeatForm);
  const [waveForm, setWaveForm] = useState(emptyWaveForm);
  const [rhythmForm, setRhythmForm] = useState(emptyRhythmForm);
  const [measurementForm, setMeasurementForm] = useState(emptyMeasurementForm);
  const [diagnosisForm, setDiagnosisForm] = useState(emptyDiagnosisForm);
  const [sourceForm, setSourceForm] = useState(emptySourceForm);
  const [versionForm, setVersionForm] = useState(emptyVersionForm);
  const [versionRecordForm, setVersionRecordForm] = useState(emptyVersionRecordForm);
  const [freezeManifest, setFreezeManifest] = useState('');

  const diagnosisTermMap = useMemo(
    () => Object.fromEntries(diagnosisTerms.map((term) => [term.id, term])),
    [diagnosisTerms]
  );

  const currentDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) || null,
    [datasets, selectedDatasetId]
  );

  const setStatus = (nextMessage, nextError = '') => {
    setMessage(nextMessage);
    setError(nextError);
  };

  const handleError = (err) => {
    setMessage('');
    setError(err.message || 'Something went wrong.');
  };

  const loadWorkspace = async () => {
    setLoading(true);
    try {
      const [datasetRows, protocolRows, termRows, assignmentRows] = await Promise.all([
        datasetService.getDatasets(),
        level5ProtocolService.listActive(),
        level5ProtocolService.listDiagnosisTerms(),
        level5AssignmentService.listMine()
      ]);
      setDatasets(datasetRows);
      setProtocols(protocolRows);
      setDiagnosisTerms(termRows);
      setAssignments(assignmentRows);
      const defaultProtocolId = protocolRows[0]?.id || '';
      setSelectedProtocolId((current) => current || defaultProtocolId);
      setVersionForm((current) => ({ ...current, protocolId: current.protocolId || defaultProtocolId }));
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };

  const loadDatasetContext = async (datasetId, preferredRecordId = '') => {
    if (!datasetId) {
      setRecords([]);
      setDatasetVersions([]);
      setSelectedVersionId('');
      return;
    }
    try {
      const [recordRows, versionRows] = await Promise.all([
        ecgService.getRecords(datasetId),
        level5DatasetVersionService.list(datasetId)
      ]);
      setRecords(recordRows);
      setDatasetVersions(versionRows);
      const nextVersionId = versionRows[0]?.id || '';
      setSelectedVersionId((current) => current || nextVersionId);
      setVersionRecordForm((current) => ({ ...current, versionId: current.versionId || nextVersionId }));
      if (preferredRecordId || recordRows.length > 0) {
        setSelectedRecordId(preferredRecordId || recordRows[0].id);
      }
    } catch (err) {
      handleError(err);
    }
  };

  const loadRecordContext = async (recordId, preferredSessionId = '') => {
    if (!recordId) {
      setSelectedRecord(null);
      setCurrentSession(null);
      setCurrentBundle(null);
      setRecordSessions([]);
      setRecordSources([]);
      return;
    }
    try {
      const [record, sessions, sources] = await Promise.all([
        ecgService.getRecordWithData(recordId),
        level5AnnotationService.listForRecord(recordId),
        level5SourceService.listForRecord(recordId)
      ]);
      setSelectedRecord(record);
      setRecordSessions(sessions);
      setRecordSources(sources);

      const draftSession = sessions.find(
        (session) =>
          session.annotator_id === currentUser.id &&
          session.status === 'draft' &&
          session.session_type === selectedSessionType
      );
      const nextSession = sessions.find((session) => session.id === preferredSessionId) || draftSession || sessions[0] || null;
      setCurrentSession(nextSession);
      setVersionRecordForm((current) => ({
        ...current,
        groundTruthSessionId: current.groundTruthSessionId || nextSession?.id || ''
      }));
      if (nextSession) {
        const bundle = await level5AnnotationService.getSessionBundle(nextSession.id);
        setCurrentBundle(bundle);
      } else {
        setCurrentBundle(null);
      }
    } catch (err) {
      handleError(err);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    if (selectedDatasetId) {
      loadDatasetContext(selectedDatasetId);
    }
  }, [selectedDatasetId]);

  useEffect(() => {
    if (selectedRecordId) {
      loadRecordContext(selectedRecordId);
    }
  }, [selectedRecordId, selectedSessionType]);

  const refreshCurrentRecord = async (preferredSessionId = currentSession?.id || '') => {
    await loadRecordContext(selectedRecordId, preferredSessionId);
  };

  const runBusyAction = async (action, successMessage) => {
    setBusy(true);
    setError('');
    try {
      await action();
      if (successMessage) setMessage(successMessage);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  const openAssignment = async (assignment) => {
    const datasetId = assignment.ecg_record?.dataset?.id;
    const recordId = assignment.ecg_record?.id;
    if (!datasetId || !recordId) return;
    setSelectedDatasetId(datasetId);
    await loadDatasetContext(datasetId, recordId);
    setMessage(`Opened assignment for ${assignment.ecg_record?.subject_key || assignment.ecg_record?.study_uid || assignment.ecg_record?.id}.`);
    setError('');
  };

  const handleSessionSelect = async (sessionId) => {
    const session = recordSessions.find((item) => item.id === sessionId) || null;
    setCurrentSession(session);
    if (!session) {
      setCurrentBundle(null);
      return;
    }
    await runBusyAction(async () => {
      const bundle = await level5AnnotationService.getSessionBundle(session.id);
      setCurrentBundle(bundle);
    });
  };

  const createSession = async () => {
    if (!selectedRecordId) {
      setStatus('', 'Choose a record first.');
      return;
    }
    await runBusyAction(async () => {
      const session = await level5AnnotationService.createSession(selectedRecordId, {
        protocolId: selectedProtocolId || null,
        sessionType: selectedSessionType,
        softwareVersion: 'level5-ui'
      });
      setCurrentSession(session);
      setVersionRecordForm((current) => ({ ...current, groundTruthSessionId: session.id }));
      await refreshCurrentRecord(session.id);
    }, 'Level 5 draft session created.');
  };

  const submitCurrentSession = async () => {
    if (!currentSession) {
      setStatus('', 'Open or create a session first.');
      return;
    }
    await runBusyAction(async () => {
      await level5AnnotationService.submitSession(currentSession.id);
      await refreshCurrentRecord(currentSession.id);
    }, 'Session submitted and locked.');
  };

  const addBeat = async (event) => {
    event.preventDefault();
    if (!currentSession) return setStatus('', 'Create a draft session first.');
    await runBusyAction(async () => {
      await level5AnnotationService.addBeat(currentSession.id, {
        sampleIndex: parseInteger(beatForm.sampleIndex),
        leadName: beatForm.leadName || null,
        beatType: beatForm.beatType,
        confidence: parseNumber(beatForm.confidence)
      });
      setBeatForm(emptyBeatForm);
      await refreshCurrentRecord(currentSession.id);
    }, 'Beat annotation added.');
  };

  const addWave = async (event) => {
    event.preventDefault();
    if (!currentSession) return setStatus('', 'Create a draft session first.');
    await runBusyAction(async () => {
      await level5AnnotationService.addWave(currentSession.id, {
        leadName: waveForm.leadName,
        beatSample: parseInteger(waveForm.beatSample),
        pOnset: parseInteger(waveForm.pOnset),
        pPeak: parseInteger(waveForm.pPeak),
        pOffset: parseInteger(waveForm.pOffset),
        qrsOnset: parseInteger(waveForm.qrsOnset),
        qPeak: parseInteger(waveForm.qPeak),
        rPeak: parseInteger(waveForm.rPeak),
        sPeak: parseInteger(waveForm.sPeak),
        qrsOffset: parseInteger(waveForm.qrsOffset),
        jPoint: parseInteger(waveForm.jPoint),
        tOnset: parseInteger(waveForm.tOnset),
        tPeak: parseInteger(waveForm.tPeak),
        tOffset: parseInteger(waveForm.tOffset),
        confidence: parseNumber(waveForm.confidence)
      });
      setWaveForm(emptyWaveForm);
      await refreshCurrentRecord(currentSession.id);
    }, 'Wave annotation added.');
  };

  const addRhythm = async (event) => {
    event.preventDefault();
    if (!currentSession) return setStatus('', 'Create a draft session first.');
    await runBusyAction(async () => {
      await level5AnnotationService.addRhythm(currentSession.id, {
        startSample: parseInteger(rhythmForm.startSample),
        endSample: parseInteger(rhythmForm.endSample),
        rhythmCode: rhythmForm.rhythmCode,
        leadName: rhythmForm.leadName || null,
        confidence: parseNumber(rhythmForm.confidence)
      });
      setRhythmForm(emptyRhythmForm);
      await refreshCurrentRecord(currentSession.id);
    }, 'Rhythm annotation added.');
  };

  const addMeasurement = async (event) => {
    event.preventDefault();
    if (!currentSession) return setStatus('', 'Create a draft session first.');
    await runBusyAction(async () => {
      await level5AnnotationService.addMeasurement(currentSession.id, {
        measurementCode: measurementForm.measurementCode,
        value: parseNumber(measurementForm.value),
        unit: measurementForm.unit,
        leadName: measurementForm.leadName || null,
        startSample: parseInteger(measurementForm.startSample),
        endSample: parseInteger(measurementForm.endSample),
        method: measurementForm.method || null,
        confidence: parseNumber(measurementForm.confidence)
      });
      setMeasurementForm(emptyMeasurementForm);
      await refreshCurrentRecord(currentSession.id);
    }, 'Measurement annotation added.');
  };

  const addDiagnosis = async (event) => {
    event.preventDefault();
    if (!currentSession) return setStatus('', 'Create a draft session first.');
    const selectedTerm = diagnosisTermMap[diagnosisForm.termId];
    await runBusyAction(async () => {
      await level5AnnotationService.addDiagnosis(currentSession.id, {
        termId: diagnosisForm.termId || null,
        displayText: diagnosisForm.displayText || selectedTerm?.display_name || '',
        certainty: diagnosisForm.certainty,
        leadNames: parseList(diagnosisForm.leadNames),
        startSample: parseInteger(diagnosisForm.startSample),
        endSample: parseInteger(diagnosisForm.endSample),
        confidence: parseNumber(diagnosisForm.confidence),
        codeSystem: selectedTerm?.code_system || null,
        code: selectedTerm?.code || null
      });
      setDiagnosisForm(emptyDiagnosisForm);
      await refreshCurrentRecord(currentSession.id);
    }, 'Diagnosis annotation added.');
  };

  const registerSource = async (event) => {
    event.preventDefault();
    if (!selectedRecordId) return setStatus('', 'Choose a record first.');
    await runBusyAction(async () => {
      await level5SourceService.register(selectedRecordId, {
        sourceKind: sourceForm.sourceKind,
        originalFilename: sourceForm.originalFilename || null,
        mediaType: sourceForm.mediaType || null,
        samplingRateHz: parseInteger(sourceForm.samplingRateHz),
        amplitudeUnit: sourceForm.amplitudeUnit || null,
        leadNames: parseList(sourceForm.leadNames),
        isOriginal: sourceForm.isOriginal
      });
      setSourceForm(emptySourceForm);
      await refreshCurrentRecord(currentSession?.id || '');
    }, 'Source provenance entry registered.');
  };

  const createVersion = async (event) => {
    event.preventDefault();
    if (!selectedDatasetId) return setStatus('', 'Choose a dataset first.');
    await runBusyAction(async () => {
      await level5DatasetVersionService.create(selectedDatasetId, {
        version: versionForm.version,
        protocolId: versionForm.protocolId || null,
        description: versionForm.description || null,
        splitSeed: parseInteger(versionForm.splitSeed),
        splitStrategy: versionForm.splitStrategy
      });
      setVersionForm((current) => ({ ...emptyVersionForm, protocolId: current.protocolId || selectedProtocolId }));
      await loadDatasetContext(selectedDatasetId, selectedRecordId);
    }, 'Dataset version created.');
  };

  const addRecordToVersion = async (event) => {
    event.preventDefault();
    if (!versionRecordForm.versionId || !selectedRecord) return setStatus('', 'Choose a dataset version and record first.');
    await runBusyAction(async () => {
      await level5DatasetVersionService.addRecord(versionRecordForm.versionId, {
        recordId: selectedRecord.id,
        groundTruthSessionId: versionRecordForm.groundTruthSessionId || null,
        split: versionRecordForm.split,
        subjectKey: selectedRecord.subject_key || selectedRecord.patient_id || selectedRecord.id
      });
      await loadDatasetContext(selectedDatasetId, selectedRecordId);
    }, 'Record added to dataset version.');
  };

  const freezeVersion = async () => {
    if (!selectedVersionId || !freezeManifest) return setStatus('', 'Choose a dataset version and enter its manifest SHA-256 first.');
    await runBusyAction(async () => {
      await level5DatasetVersionService.freeze(selectedVersionId, freezeManifest);
      await loadDatasetContext(selectedDatasetId, selectedRecordId);
    }, 'Dataset version frozen.');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="animate-spin text-blue-600" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-blue-600 hover:text-blue-700">← Back</button>
            <div className="flex items-center gap-2">
              <Heart className="text-red-500" size={28} />
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Level 5 Workspace</h1>
                <p className="text-sm text-gray-500">Protocols, sample-based sessions, provenance, assignments, and releases.</p>
              </div>
            </div>
          </div>
          <span className="text-sm text-gray-600">{currentUser.username} ({currentUser.role})</span>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {(message || error) && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
            {error || message}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-5">
            <div className="flex items-center gap-2 mb-4">
              <Database className="text-blue-500" size={20} />
              <h2 className="font-semibold text-gray-800">Dataset scope</h2>
            </div>
            <label className="block text-sm text-gray-600 mb-2">Dataset</label>
            <select
              value={selectedDatasetId}
              onChange={(event) => setSelectedDatasetId(event.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            >
              <option value="">Choose a dataset</option>
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name} ({dataset.record_count || 0} records)
                </option>
              ))}
            </select>

            <label className="block text-sm text-gray-600 mt-4 mb-2">Record</label>
            <select
              value={selectedRecordId}
              onChange={(event) => setSelectedRecordId(event.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              disabled={!records.length}
            >
              <option value="">Choose a record</option>
              {records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.subject_key || record.patient_id || record.study_uid || record.id}
                </option>
              ))}
            </select>

            {currentDataset && (
              <div className="mt-4 text-sm text-gray-600 space-y-1">
                <p><span className="font-medium">Description:</span> {currentDataset.description || '—'}</p>
                <p><span className="font-medium">Records:</span> {currentDataset.record_count || 0}</p>
                <p><span className="font-medium">Uploaded:</span> {displayTime(currentDataset.created_at)}</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <div className="flex items-center gap-2 mb-4">
              <FileText className="text-green-500" size={20} />
              <h2 className="font-semibold text-gray-800">Active protocols</h2>
            </div>
            {protocols.length === 0 ? (
              <p className="text-sm text-gray-500">No active protocol is available yet.</p>
            ) : (
              <div className="space-y-3">
                {protocols.map((protocol) => (
                  <label key={protocol.id} className="block border rounded-lg p-3 cursor-pointer">
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="protocol"
                        checked={selectedProtocolId === protocol.id}
                        onChange={() => setSelectedProtocolId(protocol.id)}
                      />
                      <div>
                        <p className="font-medium text-gray-800">{protocol.name} · {protocol.version}</p>
                        <p className="text-sm text-gray-500">{protocol.description || 'No description provided.'}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <div className="flex items-center gap-2 mb-4">
              <Users className="text-purple-500" size={20} />
              <h2 className="font-semibold text-gray-800">My assignments</h2>
            </div>
            {assignments.length === 0 ? (
              <p className="text-sm text-gray-500">No Level 5 assignments yet.</p>
            ) : (
              <div className="space-y-3">
                {assignments.slice(0, 6).map((assignment) => (
                  <button
                    key={assignment.id}
                    onClick={() => openAssignment(assignment)}
                    className="w-full text-left border rounded-lg p-3 hover:border-blue-400 transition"
                  >
                    <p className="font-medium text-gray-800">
                      {assignment.ecg_record?.dataset?.name || 'Dataset'} · {assignment.ecg_record?.subject_key || assignment.ecg_record?.study_uid || assignment.ecg_record_id}
                    </p>
                    <p className="text-sm text-gray-500">
                      {assignment.assignment_type} · {assignment.status} · quality {assignment.ecg_record?.quality_status || 'unreviewed'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {selectedRecord && (
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
            <div className="xl:col-span-1 space-y-6">
              <FormSection title="Record context">
                <p className="text-sm text-gray-600"><span className="font-medium">Study UID:</span> {selectedRecord.study_uid || '—'}</p>
                <p className="text-sm text-gray-600"><span className="font-medium">Subject key:</span> {selectedRecord.subject_key || selectedRecord.patient_id || '—'}</p>
                <p className="text-sm text-gray-600"><span className="font-medium">Quality:</span> {selectedRecord.quality_status || 'unreviewed'}</p>
                <p className="text-sm text-gray-600"><span className="font-medium">Leads:</span> {selectedRecord.lead_count || (selectedRecord.leads ? LEAD_NAMES.length : 'image')}</p>
                <p className="text-sm text-gray-600"><span className="font-medium">Duration:</span> {selectedRecord.duration ?? '—'}</p>
                <p className="text-sm text-gray-600"><span className="font-medium">Acquired:</span> {displayTime(selectedRecord.acquisition_time || selectedRecord.timestamp)}</p>
              </FormSection>

              <FormSection title="Session workspace">
                <label className="block text-sm text-gray-600">Session type</label>
                <select
                  value={selectedSessionType}
                  onChange={(event) => setSelectedSessionType(event.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  {SESSION_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>

                <button
                  onClick={createSession}
                  disabled={busy}
                  className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-semibold hover:bg-blue-700 disabled:opacity-60"
                >
                  {busy ? 'Working…' : 'Create Draft Session'}
                </button>

                <label className="block text-sm text-gray-600">Open session</label>
                <select
                  value={currentSession?.id || ''}
                  onChange={(event) => handleSessionSelect(event.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="">No session selected</option>
                  {recordSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.session_type} · round {session.round_number} · {session.status}
                    </option>
                  ))}
                </select>

                {currentSession && (
                  <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600 space-y-1">
                    <p><span className="font-medium">Protocol:</span> {currentSession.protocol?.name ? `${currentSession.protocol.name} ${currentSession.protocol.version}` : 'none'}</p>
                    <p><span className="font-medium">Annotator:</span> {currentSession.annotator?.username || currentSession.annotator_id}</p>
                    <p><span className="font-medium">Status:</span> {currentSession.status}</p>
                    <p><span className="font-medium">Submitted:</span> {displayTime(currentSession.submitted_at)}</p>
                  </div>
                )}

                <button
                  onClick={submitCurrentSession}
                  disabled={busy || !currentSession || currentSession.status !== 'draft'}
                  className="w-full bg-green-600 text-white rounded-lg py-2.5 font-semibold hover:bg-green-700 disabled:opacity-60"
                >
                  Submit Current Session
                </button>
              </FormSection>

              <FormSection title="Source provenance">
                <form onSubmit={registerSource} className="space-y-3">
                  <select
                    value={sourceForm.sourceKind}
                    onChange={(event) => setSourceForm({ ...sourceForm, sourceKind: event.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    {SOURCE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                  </select>
                  <input
                    value={sourceForm.originalFilename}
                    onChange={(event) => setSourceForm({ ...sourceForm, originalFilename: event.target.value })}
                    placeholder="Original filename"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                  <input
                    value={sourceForm.mediaType}
                    onChange={(event) => setSourceForm({ ...sourceForm, mediaType: event.target.value })}
                    placeholder="Media type"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                  <input
                    value={sourceForm.samplingRateHz}
                    onChange={(event) => setSourceForm({ ...sourceForm, samplingRateHz: event.target.value })}
                    placeholder="Sampling rate (Hz)"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                  <input
                    value={sourceForm.leadNames}
                    onChange={(event) => setSourceForm({ ...sourceForm, leadNames: event.target.value })}
                    placeholder="Lead names, comma separated"
                    className="w-full border rounded-lg px-3 py-2"
                  />
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={sourceForm.isOriginal}
                      onChange={(event) => setSourceForm({ ...sourceForm, isOriginal: event.target.checked })}
                    />
                    Original source
                  </label>
                  <button className="w-full border border-blue-600 text-blue-700 rounded-lg py-2.5 font-semibold hover:bg-blue-50">
                    Register Source
                  </button>
                </form>

                {recordSources.length > 0 && (
                  <div className="pt-2 space-y-2">
                    {recordSources.map((source) => (
                      <div key={source.id} className="rounded-lg border p-3 text-sm text-gray-600">
                        <p className="font-medium text-gray-800">{source.source_kind}</p>
                        <p>{source.original_filename || 'Unnamed source'}</p>
                        <p>{source.media_type || 'unknown media type'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </FormSection>
            </div>

            <div className="xl:col-span-3 space-y-6">
              {selectedRecord.leads ? (
                <div className="bg-white rounded-lg shadow p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Heart className="text-red-500" size={20} />
                    <h2 className="font-semibold text-gray-800">Waveform reference</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {LEAD_NAMES.slice(0, 6).map((leadName) => {
                      const samples = (selectedRecord.leads?.[leadName] || []).slice(0, 800);
                      return (
                        <div key={leadName} className="border rounded-lg p-3">
                          <p className="text-sm font-medium text-gray-700 mb-2">{leadName}</p>
                          <ResponsiveContainer width="100%" height={120}>
                            <LineChart data={samples.map((value, index) => ({ x: index, y: value }))}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                              <XAxis dataKey="x" hide />
                              <YAxis hide />
                              <Line type="monotone" dataKey="y" stroke="#2563eb" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="bg-white rounded-lg shadow p-5 text-sm text-gray-600">
                  This record is stored as an image reference. Use provenance and diagnostic session tools, or continue using the Level 4 image annotation flow.
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <FormSection title="Beat annotation">
                  <form onSubmit={addBeat} className="space-y-3">
                    <input value={beatForm.sampleIndex} onChange={(event) => setBeatForm({ ...beatForm, sampleIndex: event.target.value })} placeholder="Sample index" className="w-full border rounded-lg px-3 py-2" />
                    <div className="grid grid-cols-2 gap-3">
                      <select value={beatForm.leadName} onChange={(event) => setBeatForm({ ...beatForm, leadName: event.target.value })} className="w-full border rounded-lg px-3 py-2">
                        {LEAD_NAMES.map((lead) => <option key={lead} value={lead}>{lead}</option>)}
                      </select>
                      <select value={beatForm.beatType} onChange={(event) => setBeatForm({ ...beatForm, beatType: event.target.value })} className="w-full border rounded-lg px-3 py-2">
                        {['normal', 'pac', 'pvc', 'paced', 'fusion', 'escape', 'junctional', 'artifact', 'unknown'].map((type) => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </div>
                    <input value={beatForm.confidence} onChange={(event) => setBeatForm({ ...beatForm, confidence: event.target.value })} placeholder="Confidence 0-1" className="w-full border rounded-lg px-3 py-2" />
                    <button className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-semibold hover:bg-blue-700">Add Beat</button>
                  </form>
                </FormSection>

                <FormSection title="Rhythm annotation">
                  <form onSubmit={addRhythm} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <input value={rhythmForm.startSample} onChange={(event) => setRhythmForm({ ...rhythmForm, startSample: event.target.value })} placeholder="Start sample" className="w-full border rounded-lg px-3 py-2" />
                      <input value={rhythmForm.endSample} onChange={(event) => setRhythmForm({ ...rhythmForm, endSample: event.target.value })} placeholder="End sample" className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <input value={rhythmForm.rhythmCode} onChange={(event) => setRhythmForm({ ...rhythmForm, rhythmCode: event.target.value })} placeholder="Rhythm code" className="w-full border rounded-lg px-3 py-2" />
                    <input value={rhythmForm.leadName} onChange={(event) => setRhythmForm({ ...rhythmForm, leadName: event.target.value })} placeholder="Lead name (optional)" className="w-full border rounded-lg px-3 py-2" />
                    <input value={rhythmForm.confidence} onChange={(event) => setRhythmForm({ ...rhythmForm, confidence: event.target.value })} placeholder="Confidence 0-1" className="w-full border rounded-lg px-3 py-2" />
                    <button className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-semibold hover:bg-blue-700">Add Rhythm</button>
                  </form>
                </FormSection>

                <FormSection title="Wave landmarks">
                  <form onSubmit={addWave} className="space-y-3">
                    <select value={waveForm.leadName} onChange={(event) => setWaveForm({ ...waveForm, leadName: event.target.value })} className="w-full border rounded-lg px-3 py-2">
                      {LEAD_NAMES.map((lead) => <option key={lead} value={lead}>{lead}</option>)}
                    </select>
                    <div className="grid grid-cols-3 gap-3">
                      <input value={waveForm.beatSample} onChange={(event) => setWaveForm({ ...waveForm, beatSample: event.target.value })} placeholder="Beat sample" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.pOnset} onChange={(event) => setWaveForm({ ...waveForm, pOnset: event.target.value })} placeholder="P onset" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.pPeak} onChange={(event) => setWaveForm({ ...waveForm, pPeak: event.target.value })} placeholder="P peak" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.pOffset} onChange={(event) => setWaveForm({ ...waveForm, pOffset: event.target.value })} placeholder="P offset" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.qrsOnset} onChange={(event) => setWaveForm({ ...waveForm, qrsOnset: event.target.value })} placeholder="QRS onset" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.qPeak} onChange={(event) => setWaveForm({ ...waveForm, qPeak: event.target.value })} placeholder="Q peak" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.rPeak} onChange={(event) => setWaveForm({ ...waveForm, rPeak: event.target.value })} placeholder="R peak" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.sPeak} onChange={(event) => setWaveForm({ ...waveForm, sPeak: event.target.value })} placeholder="S peak" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.qrsOffset} onChange={(event) => setWaveForm({ ...waveForm, qrsOffset: event.target.value })} placeholder="QRS offset" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.jPoint} onChange={(event) => setWaveForm({ ...waveForm, jPoint: event.target.value })} placeholder="J point" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.tOnset} onChange={(event) => setWaveForm({ ...waveForm, tOnset: event.target.value })} placeholder="T onset" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.tPeak} onChange={(event) => setWaveForm({ ...waveForm, tPeak: event.target.value })} placeholder="T peak" className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input value={waveForm.tOffset} onChange={(event) => setWaveForm({ ...waveForm, tOffset: event.target.value })} placeholder="T offset" className="w-full border rounded-lg px-3 py-2" />
                      <input value={waveForm.confidence} onChange={(event) => setWaveForm({ ...waveForm, confidence: event.target.value })} placeholder="Confidence 0-1" className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <button className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-semibold hover:bg-blue-700">Add Wave</button>
                  </form>
                </FormSection>

                <FormSection title="Measurements">
                  <form onSubmit={addMeasurement} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <select value={measurementForm.measurementCode} onChange={(event) => setMeasurementForm({ ...measurementForm, measurementCode: event.target.value })} className="w-full border rounded-lg px-3 py-2">
                        {['HEART_RATE', 'PR_INTERVAL', 'QRS_DURATION', 'QT_INTERVAL', 'QTC_BAZETT', 'QTC_FRIDERICIA', 'QRS_AXIS', 'ST_DEVIATION'].map((code) => (
                          <option key={code} value={code}>{code}</option>
                        ))}
                      </select>
                      <input value={measurementForm.value} onChange={(event) => setMeasurementForm({ ...measurementForm, value: event.target.value })} placeholder="Numeric value" className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input value={measurementForm.unit} onChange={(event) => setMeasurementForm({ ...measurementForm, unit: event.target.value })} placeholder="Unit" className="w-full border rounded-lg px-3 py-2" />
                      <input value={measurementForm.leadName} onChange={(event) => setMeasurementForm({ ...measurementForm, leadName: event.target.value })} placeholder="Lead name (optional)" className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input value={measurementForm.startSample} onChange={(event) => setMeasurementForm({ ...measurementForm, startSample: event.target.value })} placeholder="Start sample" className="w-full border rounded-lg px-3 py-2" />
                      <input value={measurementForm.endSample} onChange={(event) => setMeasurementForm({ ...measurementForm, endSample: event.target.value })} placeholder="End sample" className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <input value={measurementForm.method} onChange={(event) => setMeasurementForm({ ...measurementForm, method: event.target.value })} placeholder="Method" className="w-full border rounded-lg px-3 py-2" />
                    <input value={measurementForm.confidence} onChange={(event) => setMeasurementForm({ ...measurementForm, confidence: event.target.value })} placeholder="Confidence 0-1" className="w-full border rounded-lg px-3 py-2" />
                    <button className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-semibold hover:bg-blue-700">Add Measurement</button>
                  </form>
                </FormSection>

                <FormSection title="Diagnoses">
                  <form onSubmit={addDiagnosis} className="space-y-3">
                    <select
                      value={diagnosisForm.termId}
                      onChange={(event) => {
                        const termId = event.target.value;
                        setDiagnosisForm({
                          ...diagnosisForm,
                          termId,
                          displayText: diagnosisTermMap[termId]?.display_name || diagnosisForm.displayText
                        });
                      }}
                      className="w-full border rounded-lg px-3 py-2"
                    >
                      <option value="">Choose a diagnosis term</option>
                      {diagnosisTerms.map((term) => (
                        <option key={term.id} value={term.id}>
                          {term.display_name} ({term.category})
                        </option>
                      ))}
                    </select>
                    <input value={diagnosisForm.displayText} onChange={(event) => setDiagnosisForm({ ...diagnosisForm, displayText: event.target.value })} placeholder="Display text" className="w-full border rounded-lg px-3 py-2" />
                    <div className="grid grid-cols-2 gap-3">
                      <select value={diagnosisForm.certainty} onChange={(event) => setDiagnosisForm({ ...diagnosisForm, certainty: event.target.value })} className="w-full border rounded-lg px-3 py-2">
                        {['definite', 'probable', 'possible', 'excluded'].map((certainty) => <option key={certainty} value={certainty}>{certainty}</option>)}
                      </select>
                      <input value={diagnosisForm.confidence} onChange={(event) => setDiagnosisForm({ ...diagnosisForm, confidence: event.target.value })} placeholder="Confidence 0-1" className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <input value={diagnosisForm.leadNames} onChange={(event) => setDiagnosisForm({ ...diagnosisForm, leadNames: event.target.value })} placeholder="Lead names, comma separated" className="w-full border rounded-lg px-3 py-2" />
                    <div className="grid grid-cols-2 gap-3">
                      <input value={diagnosisForm.startSample} onChange={(event) => setDiagnosisForm({ ...diagnosisForm, startSample: event.target.value })} placeholder="Start sample" className="w-full border rounded-lg px-3 py-2" />
                      <input value={diagnosisForm.endSample} onChange={(event) => setDiagnosisForm({ ...diagnosisForm, endSample: event.target.value })} placeholder="End sample" className="w-full border rounded-lg px-3 py-2" />
                    </div>
                    <button className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-semibold hover:bg-blue-700">Add Diagnosis</button>
                  </form>
                </FormSection>
              </div>

              <div className="bg-white rounded-lg shadow p-5">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle className="text-green-500" size={20} />
                  <h2 className="font-semibold text-gray-800">Current session bundle</h2>
                </div>
                {!currentSession ? (
                  <p className="text-sm text-gray-500">Create or open a Level 5 session to inspect its bundle.</p>
                ) : !currentBundle ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="animate-spin" size={16} /> Loading session bundle…
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className="text-sm text-gray-500">Beats</p>
                      <p className="text-3xl font-bold text-gray-800">{currentBundle.beats.length}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className="text-sm text-gray-500">Waves</p>
                      <p className="text-3xl font-bold text-gray-800">{currentBundle.waves.length}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className="text-sm text-gray-500">Rhythms</p>
                      <p className="text-3xl font-bold text-gray-800">{currentBundle.rhythms.length}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className="text-sm text-gray-500">Measurements</p>
                      <p className="text-3xl font-bold text-gray-800">{currentBundle.measurements.length}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className="text-sm text-gray-500">Diagnoses</p>
                      <p className="text-3xl font-bold text-gray-800">{currentBundle.diagnoses.length}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <FormSection title="Dataset versions">
                  <form onSubmit={createVersion} className="space-y-3">
                    <input value={versionForm.version} onChange={(event) => setVersionForm({ ...versionForm, version: event.target.value })} placeholder="Version (e.g. 1.0.0)" className="w-full border rounded-lg px-3 py-2" />
                    <textarea value={versionForm.description} onChange={(event) => setVersionForm({ ...versionForm, description: event.target.value })} placeholder="Release description" className="w-full border rounded-lg px-3 py-2" rows="3" />
                    <div className="grid grid-cols-2 gap-3">
                      <select value={versionForm.protocolId} onChange={(event) => setVersionForm({ ...versionForm, protocolId: event.target.value })} className="w-full border rounded-lg px-3 py-2">
                        <option value="">No protocol</option>
                        {protocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.name} · {protocol.version}</option>)}
                      </select>
                      <select value={versionForm.splitStrategy} onChange={(event) => setVersionForm({ ...versionForm, splitStrategy: event.target.value })} className="w-full border rounded-lg px-3 py-2">
                        {SPLIT_STRATEGIES.map((strategy) => <option key={strategy} value={strategy}>{strategy}</option>)}
                      </select>
                    </div>
                    <input value={versionForm.splitSeed} onChange={(event) => setVersionForm({ ...versionForm, splitSeed: event.target.value })} placeholder="Split seed (optional)" className="w-full border rounded-lg px-3 py-2" />
                    <button className="w-full bg-blue-600 text-white rounded-lg py-2.5 font-semibold hover:bg-blue-700">Create Dataset Version</button>
                  </form>

                  {datasetVersions.length > 0 && (
                    <div className="pt-3 space-y-2">
                      {datasetVersions.map((version) => (
                        <label key={version.id} className="block border rounded-lg p-3 cursor-pointer">
                          <div className="flex items-start gap-3">
                            <input
                              type="radio"
                              name="dataset-version"
                              checked={selectedVersionId === version.id}
                              onChange={() => {
                                setSelectedVersionId(version.id);
                                setVersionRecordForm((current) => ({ ...current, versionId: version.id }));
                              }}
                            />
                            <div className="text-sm text-gray-600">
                              <p className="font-medium text-gray-800">{version.version}</p>
                              <p>{version.status} · {getVersionRecordCount(version)} records</p>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </FormSection>

                <FormSection title="Populate and freeze release">
                  <form onSubmit={addRecordToVersion} className="space-y-3">
                    <select value={versionRecordForm.versionId} onChange={(event) => setVersionRecordForm({ ...versionRecordForm, versionId: event.target.value })} className="w-full border rounded-lg px-3 py-2">
                      <option value="">Choose a dataset version</option>
                      {datasetVersions.map((version) => <option key={version.id} value={version.id}>{version.version}</option>)}
                    </select>
                    <select value={versionRecordForm.groundTruthSessionId} onChange={(event) => setVersionRecordForm({ ...versionRecordForm, groundTruthSessionId: event.target.value })} className="w-full border rounded-lg px-3 py-2">
                      <option value="">Ground-truth session</option>
                      {recordSessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {session.session_type} · round {session.round_number} · {session.status}
                        </option>
                      ))}
                    </select>
                    <select value={versionRecordForm.split} onChange={(event) => setVersionRecordForm({ ...versionRecordForm, split: event.target.value })} className="w-full border rounded-lg px-3 py-2">
                      {SPLIT_OPTIONS.map((split) => <option key={split} value={split}>{split}</option>)}
                    </select>
                    <button className="w-full border border-blue-600 text-blue-700 rounded-lg py-2.5 font-semibold hover:bg-blue-50">
                      Add Selected Record
                    </button>
                  </form>

                  <div className="pt-3 space-y-3">
                    <input
                      value={freezeManifest}
                      onChange={(event) => setFreezeManifest(event.target.value)}
                      placeholder="Manifest SHA-256"
                      className="w-full border rounded-lg px-3 py-2"
                    />
                    <button
                      onClick={freezeVersion}
                      disabled={busy}
                      className="w-full bg-green-600 text-white rounded-lg py-2.5 font-semibold hover:bg-green-700 disabled:opacity-60"
                    >
                      Freeze Selected Version
                    </button>
                  </div>
                </FormSection>
              </div>
            </div>
          </div>
        )}

        {busy && (
          <div className="fixed bottom-6 right-6 rounded-full bg-blue-600 text-white px-4 py-2 shadow-lg flex items-center gap-2">
            <Loader2 className="animate-spin" size={16} />
            Working…
          </div>
        )}
      </div>
    </div>
  );
}
