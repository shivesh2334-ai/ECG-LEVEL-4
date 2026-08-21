import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { User, Heart, Upload, CheckCircle, AlertCircle, Eye, ChevronLeft, ChevronRight, Users, Database, FileText, Download, Loader2 } from 'lucide-react';
import { datasetService, ecgService, annotationService, statsService } from './lib/supabase';
import { parseEcgCsv } from './lib/ecgFileParser';

const LEAD_NAMES = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

const DEFAULT_USER = { username: 'User', role: 'annotator', hospital_name: '', id: null };

const ECGAnnotationPlatform = () => {
  const [currentUser] = useState(DEFAULT_USER);
  const [view, setView] = useState('dashboard');

  // Dashboard / datasets
  const [datasets, setDatasets] = useState([]);
  const [platformStats, setPlatformStats] = useState({ totalDatasets: 0, totalRecords: 0, totalUsers: 0, totalAnnotations: 0 });
  const [recentActivity, setRecentActivity] = useState([]);
  const [userAnnotationCounts, setUserAnnotationCounts] = useState({}); // datasetId -> count for current user

  // Annotate view
  const [currentDataset, setCurrentDataset] = useState(null);
  const [currentDatasetRecords, setCurrentDatasetRecords] = useState([]); // metadata only
  const [currentRecordIndex, setCurrentRecordIndex] = useState(0);
  const [currentRecordData, setCurrentRecordData] = useState(null); // metadata + leads for the active record
  const [recordLoading, setRecordLoading] = useState(false);
  const [userAnnotation, setUserAnnotation] = useState(null);
  const [recordAnnotations, setRecordAnnotations] = useState([]); // all annotators for this record
  const [annotationText, setAnnotationText] = useState('');
  const [visibleLeads, setVisibleLeads] = useState([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const [reviewMode, setReviewMode] = useState(false);

  // Upload view
  const [uploadForm, setUploadForm] = useState({ datasetName: '', description: '', file: null });
  const [uploadStatus, setUploadStatus] = useState(null); // { stage, message, progress? }

  // Review view
  const [reviewSummaries, setReviewSummaries] = useState({}); // datasetId -> { progress, annotators }
  const [reviewLoading, setReviewLoading] = useState(false);

  // Account view
  const [accountStats, setAccountStats] = useState(null);
  const [accountAnnotations, setAccountAnnotations] = useState([]);

  // ---------------------------------------------------------------------
  // Data loading effects
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (view === 'dashboard' && currentUser) {
      loadDashboardData();
    }
    if (view === 'datasets' && currentUser) {
      loadDatasetsForBrowsing();
    }
    if (view === 'review' && currentUser) {
      loadReviewData();
    }
    if (view === 'account' && currentUser) {
      loadAccountData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentUser]);

  useEffect(() => {
    if (view === 'annotate' && currentDatasetRecords.length > 0) {
      loadCurrentRecord();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, currentRecordIndex, currentDatasetRecords]);

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------
  const loadDashboardData = async () => {
    try {
      const [ds, stats, activity] = await Promise.all([
        datasetService.getDatasets(),
        statsService.getPlatformStats(),
        statsService.getRecentActivity(5)
      ]);
      setDatasets(ds);
      setPlatformStats(stats);
      setRecentActivity(activity);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  };

  const loadDatasetsForBrowsing = async () => {
    try {
      const [ds, userAnns] = await Promise.all([
        datasetService.getDatasets(),
        annotationService.getUserAnnotations(currentUser.id)
      ]);
      setDatasets(ds);

      const counts = {};
      userAnns.forEach(a => {
        const dsId = a.ecg_record?.dataset?.id;
        if (dsId) counts[dsId] = (counts[dsId] || 0) + 1;
      });
      setUserAnnotationCounts(counts);
    } catch (err) {
      console.error('Failed to load datasets:', err);
    }
  };

  const loadReviewData = async () => {
    setReviewLoading(true);
    try {
      const ds = await datasetService.getDatasets();
      setDatasets(ds);
      const summaries = {};
      for (const dataset of ds) {
        const [progress, annotators] = await Promise.all([
          datasetService.getDatasetProgress(dataset.id),
          datasetService.getDatasetAnnotationSummary(dataset.id)
        ]);
        summaries[dataset.id] = { progress, annotators };
      }
      setReviewSummaries(summaries);
    } catch (err) {
      console.error('Failed to load review data:', err);
    } finally {
      setReviewLoading(false);
    }
  };

  const loadAccountData = async () => {
    try {
      const [stats, anns] = await Promise.all([
        annotationService.getUserStats(currentUser.id),
        annotationService.getUserAnnotations(currentUser.id)
      ]);
      setAccountStats(stats);
      setAccountAnnotations(anns);
    } catch (err) {
      console.error('Failed to load account data:', err);
    }
  };

  const loadCurrentRecord = async () => {
    const meta = currentDatasetRecords[currentRecordIndex];
    if (!meta) return;
    setRecordLoading(true);
    setAnnotationText('');
    try {
      const [full, mine, all] = await Promise.all([
        ecgService.getRecordWithData(meta.id),
        annotationService.getUserAnnotation(meta.id, currentUser.id),
        annotationService.getAnnotations(meta.id)
      ]);
      setCurrentRecordData(full);
      setUserAnnotation(mine);
      setAnnotationText(mine?.diagnosis || '');
      setRecordAnnotations(all);
    } catch (err) {
      console.error('Failed to load record:', err);
      alert('Could not load this ECG record. It may be missing its waveform data.');
    } finally {
      setRecordLoading(false);
    }
  };

  // ---------------------------------------------------------------------
  // Upload (real ECG data only — see src/lib/ecgFileParser.js)
  // ---------------------------------------------------------------------
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) setUploadForm({ ...uploadForm, file });
  };

  const processUploadedData = async () => {
    if (!uploadForm.datasetName || !uploadForm.file) {
      alert('Please provide a dataset name and a CSV file');
      return;
    }

    setUploadStatus({ stage: 'reading', message: 'Reading file…' });
    try {
      const text = await uploadForm.file.text();

      setUploadStatus({ stage: 'parsing', message: 'Parsing ECG records…' });
      const { records, errors } = parseEcgCsv(text);

      setUploadStatus({ stage: 'creating', message: 'Creating dataset…' });
      const dataset = await datasetService.createDataset(
        { name: uploadForm.datasetName, description: uploadForm.description },
        currentUser.id
      );

      const results = await ecgService.batchUploadRecords(dataset.id, records, (current, total) => {
        setUploadStatus({ stage: 'uploading', message: `Uploading records…`, progress: `${current}/${total}` });
      });

      const succeeded = results.filter(r => r.success).length;
      const failed = results.length - succeeded;

      setUploadStatus(null);
      const skippedNote = errors.length > 0 ? ` ${errors.length} row(s) were skipped for invalid data.` : '';
      const failedNote = failed > 0 ? ` ${failed} record(s) failed to save — check console for details.` : '';
      alert(`Uploaded ${succeeded} of ${records.length} parsed records to "${uploadForm.datasetName}".${skippedNote}${failedNote}`);

      if (failed > 0) {
        console.error('Records that failed to upload:', results.filter(r => !r.success));
      }

      setUploadForm({ datasetName: '', description: '', file: null });
      setView('dashboard');
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadStatus(null);
      alert(`Upload failed: ${err.message}`);
    }
  };

  // ---------------------------------------------------------------------
  // Dataset / annotation navigation
  // ---------------------------------------------------------------------
  const handleDatasetSelect = async (datasetId) => {
    try {
      const records = await ecgService.getRecords(datasetId);
      if (records.length === 0) {
        alert('This dataset has no records yet.');
        return;
      }
      setCurrentDataset(datasetId);
      setCurrentDatasetRecords(records);

      const doneCount = userAnnotationCounts[datasetId] || 0;
      setCurrentRecordIndex(Math.min(doneCount, records.length - 1));
      setReviewMode(false);
      setView('annotate');
    } catch (err) {
      console.error('Failed to open dataset:', err);
      alert('Could not load this dataset.');
    }
  };

  const handleAnnotate = async (status) => {
    const record = currentDatasetRecords[currentRecordIndex];
    try {
      await annotationService.saveAnnotation(record.id, currentUser.id, {
        diagnosis: annotationText,
        status,
        findings: null,
        confidenceScore: null
      });

      if (currentRecordIndex < currentDatasetRecords.length - 1) {
        setCurrentRecordIndex(currentRecordIndex + 1);
      } else {
        alert('All records in this dataset have been annotated!');
      }
    } catch (err) {
      console.error('Failed to save annotation:', err);
      alert(`Could not save annotation: ${err.message}`);
    }
  };

  const toggleLead = (leadIndex) => {
    if (visibleLeads.includes(leadIndex)) {
      setVisibleLeads(visibleLeads.filter(l => l !== leadIndex));
    } else {
      setVisibleLeads([...visibleLeads, leadIndex].sort((a, b) => a - b));
    }
  };

  // ---------------------------------------------------------------------
  // Render: Dashboard
  // ---------------------------------------------------------------------
  const renderDashboard = () => (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center">
            <Heart className="text-red-500 mr-2" size={28} />
            <h1 className="text-2xl font-bold text-gray-800">LabelECG Platform</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-600">{currentUser.username} ({currentUser.role})</span>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Database className="text-blue-500" size={32} />
              <span className="text-3xl font-bold text-gray-800">{platformStats.totalDatasets}</span>
            </div>
            <h3 className="text-gray-600 font-semibold">Total Datasets</h3>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <FileText className="text-green-500" size={32} />
              <span className="text-3xl font-bold text-gray-800">{platformStats.totalRecords}</span>
            </div>
            <h3 className="text-gray-600 font-semibold">Total ECG Records</h3>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Users className="text-purple-500" size={32} />
              <span className="text-3xl font-bold text-gray-800">{platformStats.totalUsers}</span>
            </div>
            <h3 className="text-gray-600 font-semibold">Registered Users</h3>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <button
            onClick={() => setView('datasets')}
            className="bg-blue-600 text-white rounded-lg p-6 hover:bg-blue-700 transition shadow-md text-left"
          >
            <Eye className="mb-2" size={32} />
            <h3 className="text-xl font-semibold">View & Annotate</h3>
            <p className="text-sm opacity-90 mt-2">Browse datasets and annotate ECG records</p>
          </button>

          <button
            onClick={() => setView('upload')}
            className="bg-green-600 text-white rounded-lg p-6 hover:bg-green-700 transition shadow-md text-left"
          >
            <Upload className="mb-2" size={32} />
            <h3 className="text-xl font-semibold">Upload Data</h3>
            <p className="text-sm opacity-90 mt-2">Upload new ECG datasets for annotation</p>
          </button>

          <button
            onClick={() => setView('review')}
            className="bg-purple-600 text-white rounded-lg p-6 hover:bg-purple-700 transition shadow-md text-left"
          >
            <CheckCircle className="mb-2" size={32} />
            <h3 className="text-xl font-semibold">Review Annotations</h3>
            <p className="text-sm opacity-90 mt-2">Review and verify annotations from team</p>
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">Recent Activity</h3>
          {recentActivity.length === 0 ? (
            <p className="text-gray-400 text-sm">No annotations yet.</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <User className="text-gray-400" size={20} />
                    <span className="text-gray-700">{a.annotator?.username}</span>
                    <span className="text-sm text-gray-400">
                      {a.ecg_record?.dataset?.name} · {a.ecg_record?.patient_id}
                    </span>
                  </div>
                  <span className="text-sm text-gray-500">{new Date(a.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------
  // Render: Upload
  // ---------------------------------------------------------------------
  const renderUpload = () => (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center">
            <Heart className="text-red-500 mr-2" size={28} />
            <h1 className="text-2xl font-bold text-gray-800">Upload ECG Dataset</h1>
          </div>
          <button onClick={() => setView('dashboard')} className="text-blue-600 hover:text-blue-700">
            ← Back to Dashboard
          </button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Upload New Dataset</h2>
            <p className="text-gray-600">Upload real 12-lead ECG data in CSV format for collaborative annotation.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Dataset Name *</label>
              <input
                type="text"
                placeholder="e.g., Hospital A - Cardiology Department"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={uploadForm.datasetName}
                onChange={(e) => setUploadForm({ ...uploadForm, datasetName: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea
                placeholder="Describe the dataset, collection method, or any relevant notes..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows="3"
                value={uploadForm.description}
                onChange={(e) => setUploadForm({ ...uploadForm, description: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">ECG Data File (CSV) *</label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <Upload className="mx-auto text-gray-400 mb-2" size={48} />
                <p className="text-gray-600 mb-2">
                  {uploadForm.file ? uploadForm.file.name : 'Click to upload or drag and drop'}
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer"
                >
                  Select File
                </label>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Required columns: patient_id, timestamp, heart_rate, pr_interval, qrs_duration, qt_interval,
                sampling_rate, auto_analysis, lead_I, lead_II, lead_III, lead_aVR, lead_aVL, lead_aVF, lead_V1–V6.
                Each lead column holds that lead's real sample values separated by semicolons.
              </p>
              <a
                href="/sample-ecg-template.csv"
                download
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mt-2"
              >
                <Download size={14} /> Download CSV header template
              </a>
            </div>

            {uploadStatus && (
              <div className="p-3 bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg flex items-center gap-2">
                <Loader2 className="animate-spin" size={16} />
                {uploadStatus.message} {uploadStatus.progress}
              </div>
            )}

            <div className="flex gap-4 mt-6">
              <button
                onClick={processUploadedData}
                disabled={!!uploadStatus}
                className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition font-semibold disabled:opacity-60"
              >
                {uploadStatus ? 'Uploading…' : 'Upload Dataset'}
              </button>
              <button
                onClick={() => setView('dashboard')}
                className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-300 transition font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------
  // Render: Dataset browser
  // ---------------------------------------------------------------------
  const renderDatasets = () => (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center">
            <Heart className="text-red-500 mr-2" size={28} />
            <h1 className="text-2xl font-bold text-gray-800">Available Datasets</h1>
          </div>
          <button onClick={() => setView('dashboard')} className="text-blue-600 hover:text-blue-700">
            ← Back to Dashboard
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6">
        {datasets.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
            No datasets yet. <button onClick={() => setView('upload')} className="text-blue-600 hover:underline">Upload one</button> to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {datasets.map(dataset => {
              const annotatedCount = userAnnotationCounts[dataset.id] || 0;
              const totalCount = dataset.record_count || 0;
              const progress = totalCount > 0 ? (annotatedCount / totalCount) * 100 : 0;

              return (
                <div key={dataset.id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition">
                  <div className="p-6">
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">{dataset.name}</h3>
                    <p className="text-sm text-gray-600 mb-4">{dataset.description}</p>

                    <div className="space-y-2 text-sm text-gray-500 mb-4">
                      <p><span className="font-medium">Records:</span> {totalCount}</p>
                      <p><span className="font-medium">Uploaded by:</span> {dataset.users?.username || 'Unknown'}</p>
                      <p><span className="font-medium">Date:</span> {new Date(dataset.created_at).toLocaleDateString()}</p>
                    </div>

                    <div className="mb-4">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">Your Progress</span>
                        <span className="text-gray-600">{annotatedCount}/{totalCount}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => handleDatasetSelect(dataset.id)}
                      disabled={totalCount === 0}
                      className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50"
                    >
                      Start Annotating →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  // ---------------------------------------------------------------------
  // Render: Annotate
  // ---------------------------------------------------------------------
  const renderAnnotate = () => {
    const meta = currentDatasetRecords[currentRecordIndex];
    const record = currentRecordData;

    if (!meta) return null;

    return (
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white shadow-md px-6 py-4">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-4">
              <button onClick={() => setView('datasets')} className="text-blue-600 hover:text-blue-700">
                ← Back
              </button>
              <h1 className="text-xl font-bold text-gray-800">
                {datasets.find(d => d.id === currentDataset)?.name || 'Dataset'}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              {(currentUser.role === 'expert' || currentUser.role === 'admin') && (
                <button
                  onClick={() => setReviewMode(!reviewMode)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
                >
                  {reviewMode ? 'Annotation Mode' : 'Review Mode'}
                </button>
              )}
              <span className="text-gray-600">Record {currentRecordIndex + 1} / {currentDatasetRecords.length}</span>
            </div>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto p-6">
          {recordLoading || !record ? (
            <div className="bg-white rounded-lg shadow p-12 flex items-center justify-center text-gray-500 gap-2">
              <Loader2 className="animate-spin" size={20} /> Loading ECG waveform…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Heart size={18} className="text-red-500" />
                    ECG Parameters
                  </h3>
                  <div className="space-y-2 text-sm">
                    <p><span className="font-medium">Patient ID:</span> {record.patient_id}</p>
                    <p><span className="font-medium">Heart Rate:</span> {record.heart_rate ?? '—'} bpm</p>
                    <p><span className="font-medium">PR Interval:</span> {record.pr_interval ?? '—'} ms</p>
                    <p><span className="font-medium">QRS Duration:</span> {record.qrs_duration ?? '—'} ms</p>
                    <p><span className="font-medium">QT Interval:</span> {record.qt_interval ?? '—'} ms</p>
                    <p><span className="font-medium">Time:</span> {new Date(record.timestamp).toLocaleString()}</p>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold text-gray-700 mb-3">Automatic Analysis</h3>
                  <p className="text-sm text-gray-600">{record.auto_analysis || 'Not provided'}</p>
                </div>

                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold text-gray-700 mb-3">Your Annotation</h3>
                  {userAnnotation ? (
                    <div className="text-sm">
                      <p className="text-gray-600 mb-2">{userAnnotation.diagnosis}</p>
                      <span className={`inline-block px-2 py-1 rounded text-xs ${
                        userAnnotation.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {userAnnotation.status}
                      </span>
                      <p className="text-xs text-gray-500 mt-2">{new Date(userAnnotation.updated_at || userAnnotation.created_at).toLocaleString()}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">Not yet annotated</p>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow p-4">
                  <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Users size={18} className="text-purple-500" />
                    Team Annotations
                  </h3>
                  <div className="space-y-2 text-sm">
                    {recordAnnotations.length > 0 ? (
                      recordAnnotations.map(a => (
                        <div key={a.id} className="flex justify-between items-center">
                          <span className="text-gray-600">{a.annotator?.username}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            a.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>{a.status}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-gray-400">No annotations yet</p>
                    )}
                  </div>
                </div>
              </div>

              {reviewMode && (currentUser.role === 'expert' || currentUser.role === 'admin') && (
                <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-6 mb-6">
                  <h3 className="font-semibold text-purple-800 mb-4 flex items-center gap-2">
                    <Eye size={20} />
                    Review Mode - All Annotations for this Record
                  </h3>
                  <div className="space-y-3">
                    {recordAnnotations.length === 0 && <p className="text-gray-500 text-sm">No annotations yet.</p>}
                    {recordAnnotations.map(a => (
                      <div key={a.id} className="bg-white rounded-lg p-4 border border-purple-200">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className="font-semibold text-gray-800">{a.annotator?.username}</span>
                            <span className="text-sm text-gray-500 ml-2">({a.annotator?.role})</span>
                            <p className="text-xs text-gray-500">{a.annotator?.hospital_name}</p>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs ${
                            a.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {a.status}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700">{a.diagnosis}</p>
                        <p className="text-xs text-gray-500 mt-2">{new Date(a.updated_at || a.created_at).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-gray-700">Lead Selection</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setVisibleLeads([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])}
                      className="text-sm px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      Show All
                    </button>
                    <button
                      onClick={() => setVisibleLeads([1, 5, 9])}
                      className="text-sm px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      Key Leads
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {LEAD_NAMES.map((name, idx) => (
                    <button
                      key={idx}
                      onClick={() => toggleLead(idx)}
                      className={`px-3 py-1 rounded text-sm font-medium transition ${
                        visibleLeads.includes(idx)
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h3 className="font-semibold text-gray-700 mb-4">
                  ECG Waveforms — 12-Lead Display ({record.samplingRate} Hz, {record.duration?.toFixed(2)}s)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {visibleLeads.map(leadIdx => {
                    const leadKey = LEAD_NAMES[leadIdx];
                    const samples = record.leads[leadKey] || [];
                    return (
                      <div key={leadIdx} className="border border-gray-200 rounded-lg p-3">
                        <p className="text-sm font-semibold text-gray-700 mb-2">{leadKey}</p>
                        <ResponsiveContainer width="100%" height={120}>
                          <LineChart data={samples.map((value, idx) => ({ x: idx, y: value }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                            <XAxis dataKey="x" hide />
                            <YAxis hide />
                            <Line type="monotone" dataKey="y" stroke="#3b82f6" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}
                </div>
              </div>

              {!reviewMode && (
                <div className="bg-white rounded-lg shadow p-6">
                  <h3 className="font-semibold text-gray-700 mb-4">Make Annotation</h3>
                  <textarea
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                    rows="4"
                    placeholder="Enter your diagnosis, observations, and clinical interpretation..."
                    value={annotationText}
                    onChange={(e) => setAnnotationText(e.target.value)}
                  />

                  <div className="flex gap-4 mb-4">
                    <button
                      onClick={() => handleAnnotate('confirmed')}
                      className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition font-semibold flex items-center justify-center gap-2"
                    >
                      <CheckCircle size={20} />
                      Confirm
                    </button>
                    <button
                      onClick={() => handleAnnotate('unsure')}
                      className="flex-1 bg-yellow-600 text-white py-3 rounded-lg hover:bg-yellow-700 transition font-semibold flex items-center justify-center gap-2"
                    >
                      <AlertCircle size={20} />
                      Mark as Unsure
                    </button>
                  </div>

                  <div className="flex justify-between">
                    <button
                      onClick={() => setCurrentRecordIndex(Math.max(0, currentRecordIndex - 1))}
                      disabled={currentRecordIndex === 0}
                      className="flex items-center gap-2 px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      <ChevronLeft size={20} />
                      Previous
                    </button>
                    <button
                      onClick={() => setCurrentRecordIndex(Math.min(currentDatasetRecords.length - 1, currentRecordIndex + 1))}
                      disabled={currentRecordIndex === currentDatasetRecords.length - 1}
                      className="flex items-center gap-2 px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      Next
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------
  // Render: Review
  // ---------------------------------------------------------------------
  const renderReview = () => (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-md px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center">
            <Heart className="text-red-500 mr-2" size={28} />
            <h1 className="text-2xl font-bold text-gray-800">Review Annotations</h1>
          </div>
          <button onClick={() => setView('dashboard')} className="text-blue-600 hover:text-blue-700">
            ← Back to Dashboard
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">Coverage by Dataset</h3>
          {reviewLoading ? (
            <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
              <Loader2 className="animate-spin" size={20} /> Loading…
            </div>
          ) : datasets.length === 0 ? (
            <p className="text-gray-400 text-sm">No datasets yet.</p>
          ) : (
            <div className="space-y-4">
              {datasets.map(dataset => {
                const summary = reviewSummaries[dataset.id];
                const progress = summary?.progress || { total_records: dataset.record_count, annotated_records: 0, coverage: 0 };
                const annotators = summary?.annotators || [];

                return (
                  <div key={dataset.id} className="border border-gray-200 rounded-lg p-4">
                    <h4 className="font-semibold text-gray-800 mb-3">{dataset.name}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-blue-600">{progress.total_records}</p>
                        <p className="text-sm text-gray-600">Total Records</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-600">{progress.annotated_records}</p>
                        <p className="text-sm text-gray-600">Annotated</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-purple-600">{annotators.length}</p>
                        <p className="text-sm text-gray-600">Annotators</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-orange-600">{Math.round(progress.coverage || 0)}%</p>
                        <p className="text-sm text-gray-600">Coverage</p>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
                      <div
                        className="bg-green-600 h-3 rounded-full transition-all"
                        style={{ width: `${progress.coverage || 0}%` }}
                      />
                    </div>
                    {annotators.length > 0 && (
                      <div className="flex flex-wrap gap-3 text-sm text-gray-600">
                        {annotators.map(a => (
                          <span key={a.annotator_id} className="bg-gray-100 px-3 py-1 rounded-full">
                            {a.username}: {a.annotated_count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // ---------------------------------------------------------------------
  // Render: Account
  // ---------------------------------------------------------------------
  const renderAccount = () => {
    const grouped = {};
    accountAnnotations.forEach(a => {
      const dsId = a.ecg_record?.dataset?.id;
      const dsName = a.ecg_record?.dataset?.name;
      if (!dsId) return;
      if (!grouped[dsId]) grouped[dsId] = { name: dsName, items: [] };
      grouped[dsId].items.push(a);
    });

    return (
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white shadow-md px-6 py-4">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center">
              <Heart className="text-red-500 mr-2" size={28} />
              <h1 className="text-2xl font-bold text-gray-800">My Account</h1>
            </div>
            <button onClick={() => setView('dashboard')} className="text-blue-600 hover:text-blue-700">
              ← Back to Dashboard
            </button>
          </div>
        </nav>

        <div className="max-w-6xl mx-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Profile Information</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Username</p>
                  <p className="font-medium text-gray-800">{currentUser.username}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Role</p>
                  <p className="font-medium text-gray-800 capitalize">{currentUser.role}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Institution</p>
                  <p className="font-medium text-gray-800">{currentUser.hospital_name}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Annotation Stats</h3>
              <div className="text-center">
                <p className="text-5xl font-bold text-blue-600 mb-2">{accountStats?.total_annotations ?? 0}</p>
                <p className="text-gray-600">Total Annotations</p>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Datasets Worked On</h3>
              <div className="text-center">
                <p className="text-5xl font-bold text-green-600 mb-2">{accountStats?.datasets_worked_on ?? 0}</p>
                <p className="text-gray-600">Datasets</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">My Annotation History</h3>

            {Object.keys(grouped).length === 0 ? (
              <p className="text-gray-500 text-center py-8">No annotations yet. Start annotating from the dashboard!</p>
            ) : (
              <div className="space-y-6">
                {Object.entries(grouped).map(([datasetId, group]) => (
                  <div key={datasetId} className="border-l-4 border-blue-500 pl-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-700 text-lg">{group.name}</h4>
                        <p className="text-sm text-gray-500">{group.items.length} records annotated</p>
                      </div>
                      <button
                        onClick={() => handleDatasetSelect(datasetId)}
                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
                      >
                        Continue →
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {group.items.map((a) => (
                        <div key={a.id} className="bg-gray-50 p-3 rounded-lg">
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-sm font-medium text-gray-600">Patient: {a.ecg_record?.patient_id}</span>
                            <span className={`px-2 py-1 rounded text-xs ${
                              a.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {a.status}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 mb-2">{a.diagnosis}</p>
                          <p className="text-xs text-gray-500">{new Date(a.updated_at || a.created_at).toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------
  if (view === 'dashboard') return renderDashboard();
  if (view === 'upload') return renderUpload();
  if (view === 'datasets') return renderDatasets();
  if (view === 'annotate') return renderAnnotate();
  if (view === 'review') return renderReview();
  if (view === 'account') return renderAccount();

  return null;
};

export default ECGAnnotationPlatform;
