import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { User, Heart, Upload, CheckCircle, AlertCircle, Eye, ChevronLeft, ChevronRight, Settings, LogOut, Users, Database, FileText, Download } from 'lucide-react';

const ECGAnnotationPlatform = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState('login');
  const [users, setUsers] = useState({});
  const [datasets, setDatasets] = useState({});
  const [annotations, setAnnotations] = useState({});
  const [currentDataset, setCurrentDataset] = useState(null);
  const [currentRecordIndex, setCurrentRecordIndex] = useState(0);
  const [annotationText, setAnnotationText] = useState('');
  const [visibleLeads, setVisibleLeads] = useState([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ username: '', password: '', role: 'annotator', verificationCode: '', hospitalName: '' });
  const [uploadForm, setUploadForm] = useState({ datasetName: '', description: '', file: null });
  const [reviewMode, setReviewMode] = useState(false);
  const [selectedAnnotator, setSelectedAnnotator] = useState(null);

  // Load data from shared storage on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const usersData = await window.storage.get('users', true);
      const datasetsData = await window.storage.get('datasets', true);
      const annotationsData = await window.storage.get('annotations', true);
      
      if (usersData) setUsers(JSON.parse(usersData.value));
      if (datasetsData) setDatasets(JSON.parse(datasetsData.value));
      if (annotationsData) setAnnotations(JSON.parse(annotationsData.value));
    } catch (error) {
      console.log('Initializing new storage');
      initializeSampleData();
    }
  };

  const saveData = async (type, data) => {
    try {
      await window.storage.set(type, JSON.stringify(data), true);
    } catch (error) {
      console.error('Error saving data:', error);
      alert('Error saving data. Please try again.');
    }
  };

  const initializeSampleData = () => {
    const generateECGData = (numSamples = 500, type = 'normal') => {
      const data = [];
      for (let i = 0; i < numSamples; i++) {
        const baseValue = type === 'afib' ? Math.random() * 0.3 : 0;
        const noise = type === 'noisy' ? Math.random() * 0.2 : Math.random() * 0.05;
        data.push(Math.sin(i * 0.1) * (0.5 + baseValue) + noise);
      }
      return data;
    };

    const sampleDatasets = {
      'dataset1': {
        id: 'dataset1',
        name: 'Beijing Tsinghua Hospital - Resting ECG',
        description: '12-lead resting ECG records from cardiology department',
        uploadedBy: 'admin',
        uploadDate: '2024-10-01',
        records: [
          {
            id: 'rec1',
            patientId: 'P001',
            timestamp: '2024-10-01T10:30:00',
            heartRate: 72,
            prInterval: 160,
            qrsDuration: 90,
            qtInterval: 380,
            leads: Array(12).fill(null).map(() => generateECGData(500, 'normal')),
            autoAnalysis: 'Normal sinus rhythm',
            leadNames: ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']
          },
          {
            id: 'rec2',
            patientId: 'P002',
            timestamp: '2024-10-01T11:00:00',
            heartRate: 95,
            prInterval: 180,
            qrsDuration: 95,
            qtInterval: 420,
            leads: Array(12).fill(null).map(() => generateECGData(500, 'afib')),
            autoAnalysis: 'Possible atrial fibrillation - irregular rhythm detected',
            leadNames: ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']
          },
          {
            id: 'rec3',
            patientId: 'P003',
            timestamp: '2024-10-01T11:30:00',
            heartRate: 68,
            prInterval: 155,
            qrsDuration: 88,
            qtInterval: 390,
            leads: Array(12).fill(null).map(() => generateECGData(500, 'normal')),
            autoAnalysis: 'Normal sinus rhythm with sinus arrhythmia',
            leadNames: ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']
          }
        ]
      }
    };

    const sampleUsers = {
      'admin': { username: 'admin', password: 'admin123', role: 'admin', hospitalName: 'System Administrator' },
      'doctor1': { username: 'doctor1', password: 'doc123', role: 'expert', hospitalName: 'Beijing Tsinghua Hospital' },
      'doctor2': { username: 'doctor2', password: 'doc456', role: 'expert', hospitalName: 'Qingdao Hospital' },
      'tech1': { username: 'tech1', password: 'tech123', role: 'annotator', hospitalName: 'Beijing Tsinghua Hospital' },
      'tech2': { username: 'tech2', password: 'tech456', role: 'annotator', hospitalName: 'Tianjin Hospital' }
    };

    setUsers(sampleUsers);
    setDatasets(sampleDatasets);
    saveData('users', sampleUsers);
    saveData('datasets', sampleDatasets);
  };

  const handleLogin = () => {
    const user = users[loginForm.username];
    if (user && user.password === loginForm.password) {
      setCurrentUser(user);
      setView('dashboard');
    } else {
      alert('Invalid credentials');
    }
  };

  const handleRegister = () => {
    if (registerForm.verificationCode !== 'VERIFY2024') {
      alert('Invalid verification code. Contact your administrator.');
      return;
    }
    if (users[registerForm.username]) {
      alert('Username already exists');
      return;
    }
    const newUsers = {
      ...users,
      [registerForm.username]: {
        username: registerForm.username,
        password: registerForm.password,
        role: registerForm.role,
        hospitalName: registerForm.hospitalName
      }
    };
    setUsers(newUsers);
    saveData('users', newUsers);
    alert('Registration successful! Please login.');
    setView('login');
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      setUploadForm({ ...uploadForm, file: file });
    }
  };

  const processUploadedData = async () => {
    if (!uploadForm.datasetName || !uploadForm.file) {
      alert('Please provide dataset name and file');
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target.result;
          const lines = content.split('\n');
          
          // Parse CSV data (simplified format)
          const records = [];
          let currentRecord = null;
          
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const values = line.split(',');
            if (values.length >= 12) {
              currentRecord = {
                id: `rec${i}`,
                patientId: values[0] || `P${String(i).padStart(3, '0')}`,
                timestamp: new Date().toISOString(),
                heartRate: parseInt(values[1]) || 75,
                prInterval: parseInt(values[2]) || 160,
                qrsDuration: parseInt(values[3]) || 90,
                qtInterval: parseInt(values[4]) || 380,
                leads: Array(12).fill(null).map(() => {
                  return Array(500).fill(0).map(() => Math.sin(Math.random() * 10) * 0.5 + Math.random() * 0.1);
                }),
                autoAnalysis: values[5] || 'Automatic analysis pending',
                leadNames: ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']
              };
              records.push(currentRecord);
            }
          }

          if (records.length === 0) {
            alert('No valid records found in file');
            return;
          }

          const newDatasetId = `dataset${Date.now()}`;
          const newDataset = {
            id: newDatasetId,
            name: uploadForm.datasetName,
            description: uploadForm.description,
            uploadedBy: currentUser.username,
            uploadDate: new Date().toISOString().split('T')[0],
            records: records
          };

          const newDatasets = { ...datasets, [newDatasetId]: newDataset };
          setDatasets(newDatasets);
          await saveData('datasets', newDatasets);
          
          alert(`Successfully uploaded ${records.length} records!`);
          setUploadForm({ datasetName: '', description: '', file: null });
          setView('dashboard');
        } catch (error) {
          console.error('Error parsing file:', error);
          alert('Error parsing file. Please check format.');
        }
      };
      
      reader.readAsText(uploadForm.file);
    } catch (error) {
      console.error('Error reading file:', error);
      alert('Error reading file');
    }
  };

  const handleDatasetSelect = (datasetId) => {
    setCurrentDataset(datasetId);
    const userAnnotations = annotations[currentUser.username] || {};
    const datasetAnnotations = userAnnotations[datasetId] || {};
    const recordIds = Object.keys(datasetAnnotations);
    if (recordIds.length > 0) {
      const lastIndex = datasets[datasetId].records.findIndex(r => r.id === recordIds[recordIds.length - 1]);
      setCurrentRecordIndex(lastIndex + 1 < datasets[datasetId].records.length ? lastIndex + 1 : 0);
    } else {
      setCurrentRecordIndex(0);
    }
    setReviewMode(false);
    setView('annotate');
  };

  const handleAnnotate = async (status) => {
    const record = datasets[currentDataset].records[currentRecordIndex];
    const newAnnotations = {
      ...annotations,
      [currentUser.username]: {
        ...(annotations[currentUser.username] || {}),
        [currentDataset]: {
          ...((annotations[currentUser.username] || {})[currentDataset] || {}),
          [record.id]: {
            text: annotationText,
            status: status,
            timestamp: new Date().toISOString(),
            annotatorRole: currentUser.role,
            hospitalName: currentUser.hospitalName
          }
        }
      }
    };
    setAnnotations(newAnnotations);
    await saveData('annotations', newAnnotations);
    setAnnotationText('');
    
    if (currentRecordIndex < datasets[currentDataset].records.length - 1) {
      setCurrentRecordIndex(currentRecordIndex + 1);
    } else {
      alert('All records annotated!');
    }
  };

  const toggleLead = (leadIndex) => {
    if (visibleLeads.includes(leadIndex)) {
      setVisibleLeads(visibleLeads.filter(l => l !== leadIndex));
    } else {
      setVisibleLeads([...visibleLeads, leadIndex].sort());
    }
  };

  const getAllAnnotators = () => {
    const annotators = new Set();
    Object.keys(annotations).forEach(username => {
      if (annotations[username][currentDataset]) {
        annotators.add(username);
      }
    });
    return Array.from(annotators);
  };

  const renderLogin = () => (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
        <div className="flex items-center justify-center mb-6">
          <Heart className="text-red-500 mr-2" size={32} />
          <h1 className="text-3xl font-bold text-gray-800">LabelECG</h1>
        </div>
        <p className="text-center text-gray-600 mb-6">Distributed ECG Annotation Platform</p>
        
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Username"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={loginForm.username}
            onChange={(e) => setLoginForm({...loginForm, username: e.target.value})}
          />
          <input
            type="password"
            placeholder="Password"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={loginForm.password}
            onChange={(e) => setLoginForm({...loginForm, password: e.target.value})}
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
          />
          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-semibold"
          >
            Login
          </button>
          <button
            onClick={() => setView('register')}
            className="w-full bg-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-300 transition font-semibold"
          >
            Register New Account
          </button>
        </div>
        
        <div className="mt-6 text-sm text-gray-500">
          <p className="font-semibold mb-2">Demo Accounts:</p>
          <p>Admin: admin/admin123</p>
          <p>Expert: doctor1/doc123 | doctor2/doc456</p>
          <p>Annotator: tech1/tech123 | tech2/tech456</p>
        </div>
      </div>
    </div>
  );

  const renderRegister = () => (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Register New Account</h2>
        
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Username"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={registerForm.username}
            onChange={(e) => setRegisterForm({...registerForm, username: e.target.value})}
          />
          <input
            type="password"
            placeholder="Password"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={registerForm.password}
            onChange={(e) => setRegisterForm({...registerForm, password: e.target.value})}
          />
          <input
            type="text"
            placeholder="Hospital/Institution Name"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={registerForm.hospitalName}
            onChange={(e) => setRegisterForm({...registerForm, hospitalName: e.target.value})}
          />
          <select
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={registerForm.role}
            onChange={(e) => setRegisterForm({...registerForm, role: e.target.value})}
          >
            <option value="annotator">Annotator (Technician)</option>
            <option value="expert">Expert (Physician)</option>
            <option value="admin">Administrator</option>
          </select>
          <input
            type="text"
            placeholder="Verification Code"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={registerForm.verificationCode}
            onChange={(e) => setRegisterForm({...registerForm, verificationCode: e.target.value})}
          />
          <button
            onClick={handleRegister}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-semibold"
          >
            Register
          </button>
          <button
            onClick={() => setView('login')}
            className="w-full bg-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-300 transition font-semibold"
          >
            Back to Login
          </button>
        </div>
        
        <div className="mt-4 text-sm text-gray-500 text-center">
          <p>Verification code: VERIFY2024</p>
        </div>
      </div>
    </div>
  );

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
            <span className="text-sm text-gray-500">{currentUser.hospitalName}</span>
            <button onClick={() => setView('account')} className="p-2 hover:bg-gray-100 rounded-lg">
              <Settings size={20} />
            </button>
            <button onClick={() => { setCurrentUser(null); setView('login'); }} className="p-2 hover:bg-gray-100 rounded-lg">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </nav>
      
      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Database className="text-blue-500" size={32} />
              <span className="text-3xl font-bold text-gray-800">{Object.keys(datasets).length}</span>
            </div>
            <h3 className="text-gray-600 font-semibold">Total Datasets</h3>
          </div>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <FileText className="text-green-500" size={32} />
              <span className="text-3xl font-bold text-gray-800">
                {Object.values(datasets).reduce((sum, ds) => sum + ds.records.length, 0)}
              </span>
            </div>
            <h3 className="text-gray-600 font-semibold">Total ECG Records</h3>
          </div>
          
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between mb-4">
              <Users className="text-purple-500" size={32} />
              <span className="text-3xl font-bold text-gray-800">{Object.keys(users).length}</span>
            </div>
            <h3 className="text-gray-600 font-semibold">Registered Users</h3>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <button
            onClick={() => setView('datasets')}
            className="bg-blue-600 text-white rounded-lg p-6 hover:bg-blue-700 transition shadow-md"
          >
            <Eye className="mb-2" size={32} />
            <h3 className="text-xl font-semibold">View & Annotate</h3>
            <p className="text-sm opacity-90 mt-2">Browse datasets and annotate ECG records</p>
          </button>
          
          <button
            onClick={() => setView('upload')}
            className="bg-green-600 text-white rounded-lg p-6 hover:bg-green-700 transition shadow-md"
          >
            <Upload className="mb-2" size={32} />
            <h3 className="text-xl font-semibold">Upload Data</h3>
            <p className="text-sm opacity-90 mt-2">Upload new ECG datasets for annotation</p>
          </button>
          
          <button
            onClick={() => setView('review')}
            className="bg-purple-600 text-white rounded-lg p-6 hover:bg-purple-700 transition shadow-md"
          >
            <CheckCircle className="mb-2" size={32} />
            <h3 className="text-xl font-semibold">Review Annotations</h3>
            <p className="text-sm opacity-90 mt-2">Review and verify annotations from team</p>
          </button>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">Recent Activity</h3>
          <div className="space-y-3">
            {Object.entries(annotations).slice(0, 5).map(([username, userAnns], idx) => (
              <div key={idx} className="flex items-center justify-between py-2 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <User className="text-gray-400" size={20} />
                  <span className="text-gray-700">{username}</span>
                </div>
                <span className="text-sm text-gray-500">
                  {Object.values(userAnns).reduce((sum, ds) => sum + Object.keys(ds).length, 0)} annotations
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

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
            <p className="text-gray-600">Upload ECG data in CSV format for collaborative annotation</p>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Dataset Name *</label>
              <input
                type="text"
                placeholder="e.g., Hospital A - Cardiology Department"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={uploadForm.datasetName}
                onChange={(e) => setUploadForm({...uploadForm, datasetName: e.target.value})}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea
                placeholder="Describe the dataset, collection method, or any relevant notes..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows="3"
                value={uploadForm.description}
                onChange={(e) => setUploadForm({...uploadForm, description: e.target.value})}
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
                Format: PatientID, HeartRate, PR, QRS, QT, AutoAnalysis
              </p>
            </div>
            
            <div className="flex gap-4 mt-6">
              <button
                onClick={processUploadedData}
                className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700 transition font-semibold"
              >
                Upload Dataset
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.values(datasets).map(dataset => {
            const userAnnotationCount = ((annotations[currentUser.username] || {})[dataset.id] || {});
            const annotatedCount = Object.keys(userAnnotationCount).length;
            const totalCount = dataset.records.length;
            const progress = (annotatedCount / totalCount) * 100;
            
            return (
              <div key={dataset.id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition">
                <div className="p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-2">{dataset.name}</h3>
                  <p className="text-sm text-gray-600 mb-4">{dataset.description}</p>
                  
                  <div className="space-y-2 text-sm text-gray-500 mb-4">
                    <p><span className="font-medium">Records:</span> {dataset.records.length}</p>
                    <p><span className="font-medium">Uploaded by:</span> {dataset.uploadedBy}</p>
                    <p><span className="font-medium">Date:</span> {dataset.uploadDate}</p>
                  </div>
                  
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Your Progress</span>
                      <span className="text-gray-600">{annotatedCount}/{totalCount}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all" 
                        style={{width: `${progress}%`}}
                      />
                    </div>
                  </div>
                  
                  <button
                    onClick={() => handleDatasetSelect(dataset.id)}
                    className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition font-semibold"
                  >
                    Start Annotating →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderAnnotate = () => {
    const record = datasets[currentDataset].records[currentRecordIndex];
    const userAnnotation = ((annotations[currentUser.username] || {})[currentDataset] || {})[record.id];
    const allAnnotators = getAllAnnotators();
    
    return (
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white shadow-md px-6 py-4">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <div className="flex items-center gap-4">
              <button onClick={() => setView('datasets')} className="text-blue-600 hover:text-blue-700">
                ← Back
              </button>
              <h1 className="text-xl font-bold text-gray-800">{datasets[currentDataset].name}</h1>
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
              <span className="text-gray-600">Record {currentRecordIndex + 1} / {datasets[currentDataset].records.length}</span>
            </div>
          </div>
        </nav>
        
        <div className="max-w-7xl mx-auto p-6">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Heart size={18} className="text-red-500" />
                ECG Parameters
              </h3>
              <div className="space-y-2 text-sm">
                <p><span className="font-medium">Patient ID:</span> {record.patientId}</p>
                <p><span className="font-medium">Heart Rate:</span> {record.heartRate} bpm</p>
                <p><span className="font-medium">PR Interval:</span> {record.prInterval} ms</p>
                <p><span className="font-medium">QRS Duration:</span> {record.qrsDuration} ms</p>
                <p><span className="font-medium">QT Interval:</span> {record.qtInterval} ms</p>
                <p><span className="font-medium">Time:</span> {new Date(record.timestamp).toLocaleString()}</p>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold text-gray-700 mb-3">Automatic Analysis</h3>
              <p className="text-sm text-gray-600">{record.autoAnalysis}</p>
            </div>
            
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold text-gray-700 mb-3">Your Annotation</h3>
              {userAnnotation ? (
                <div className="text-sm">
                  <p className="text-gray-600 mb-2">{userAnnotation.text}</p>
                  <span className={`inline-block px-2 py-1 rounded text-xs ${
                    userAnnotation.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {userAnnotation.status}
                  </span>
                  <p className="text-xs text-gray-500 mt-2">{new Date(userAnnotation.timestamp).toLocaleString()}</p>
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
                {allAnnotators.length > 0 ? (
                  allAnnotators.map(annotator => {
                    const count = Object.keys(annotations[annotator][currentDataset] || {}).length;
                    return (
                      <div key={annotator} className="flex justify-between items-center">
                        <span className="text-gray-600">{annotator}</span>
                        <span className="text-gray-500">{count} done</span>
                      </div>
                    );
                  })
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
                {allAnnotators.map(annotator => {
                  const annotation = annotations[annotator][currentDataset]?.[record.id];
                  return annotation ? (
                    <div key={annotator} className="bg-white rounded-lg p-4 border border-purple-200">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="font-semibold text-gray-800">{annotator}</span>
                          <span className="text-sm text-gray-500 ml-2">({annotation.annotatorRole})</span>
                          <p className="text-xs text-gray-500">{annotation.hospitalName}</p>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs ${
                          annotation.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {annotation.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700">{annotation.text}</p>
                      <p className="text-xs text-gray-500 mt-2">{new Date(annotation.timestamp).toLocaleString()}</p>
                    </div>
                  ) : null;
                })}
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
              {record.leadNames.map((name, idx) => (
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
            <h3 className="font-semibold text-gray-700 mb-4">ECG Waveforms - 12-Lead Display</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleLeads.map(leadIdx => (
                <div key={leadIdx} className="border border-gray-200 rounded-lg p-3">
                  <p className="text-sm font-semibold text-gray-700 mb-2">{record.leadNames[leadIdx]}</p>
                  <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={record.leads[leadIdx].map((value, idx) => ({ x: idx, y: value }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                      <XAxis dataKey="x" hide />
                      <YAxis domain={[-1.5, 1.5]} hide />
                      <Line type="monotone" dataKey="y" stroke="#3b82f6" dot={false} strokeWidth={1.5} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
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
                  onClick={() => setCurrentRecordIndex(Math.min(datasets[currentDataset].records.length - 1, currentRecordIndex + 1))}
                  disabled={currentRecordIndex === datasets[currentDataset].records.length - 1}
                  className="flex items-center gap-2 px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Next
                  <ChevronRight size={20} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderReview = () => {
    return (
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
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Annotation Statistics by User</h3>
            <div className="space-y-4">
              {Object.entries(annotations).map(([username, userAnns]) => {
                const totalAnnotations = Object.values(userAnns).reduce((sum, ds) => sum + Object.keys(ds).length, 0);
                const user = users[username];
                
                return (
                  <div key={username} className="border-l-4 border-blue-500 pl-4 py-2">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="font-semibold text-gray-800">{username}</span>
                        <span className="text-sm text-gray-500 ml-2">({user?.role})</span>
                        <p className="text-sm text-gray-600">{user?.hospitalName}</p>
                      </div>
                      <span className="text-2xl font-bold text-blue-600">{totalAnnotations}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {Object.entries(userAnns).map(([datasetId, dsAnns]) => (
                        <div key={datasetId} className="flex justify-between text-sm text-gray-600">
                          <span>{datasets[datasetId]?.name}</span>
                          <span>{Object.keys(dsAnns).length} records</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">Dataset Coverage</h3>
            <div className="space-y-6">
              {Object.values(datasets).map(dataset => {
                const annotators = new Set();
                const recordCoverage = {};
                
                Object.entries(annotations).forEach(([username, userAnns]) => {
                  if (userAnns[dataset.id]) {
                    annotators.add(username);
                    Object.keys(userAnns[dataset.id]).forEach(recordId => {
                      recordCoverage[recordId] = (recordCoverage[recordId] || 0) + 1;
                    });
                  }
                });
                
                const totalRecords = dataset.records.length;
                const annotatedRecords = Object.keys(recordCoverage).length;
                const coverage = (annotatedRecords / totalRecords) * 100;
                
                return (
                  <div key={dataset.id} className="border border-gray-200 rounded-lg p-4">
                    <h4 className="font-semibold text-gray-800 mb-3">{dataset.name}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                      <div className="text-center">
                        <p className="text-2xl font-bold text-blue-600">{totalRecords}</p>
                        <p className="text-sm text-gray-600">Total Records</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-green-600">{annotatedRecords}</p>
                        <p className="text-sm text-gray-600">Annotated</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-purple-600">{annotators.size}</p>
                        <p className="text-sm text-gray-600">Annotators</p>
                      </div>
                      <div className="text-center">
                        <p className="text-2xl font-bold text-orange-600">{Math.round(coverage)}%</p>
                        <p className="text-sm text-gray-600">Coverage</p>
                      </div>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div 
                        className="bg-green-600 h-3 rounded-full transition-all" 
                        style={{width: `${coverage}%`}}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAccount = () => {
    const userAnnotations = annotations[currentUser.username] || {};
    const totalAnnotations = Object.values(userAnnotations).reduce((sum, ds) => sum + Object.keys(ds).length, 0);
    
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
                  <p className="font-medium text-gray-800">{currentUser.hospitalName}</p>
                </div>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Annotation Stats</h3>
              <div className="text-center">
                <p className="text-5xl font-bold text-blue-600 mb-2">{totalAnnotations}</p>
                <p className="text-gray-600">Total Annotations</p>
              </div>
            </div>
            
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Datasets Worked On</h3>
              <div className="text-center">
                <p className="text-5xl font-bold text-green-600 mb-2">{Object.keys(userAnnotations).length}</p>
                <p className="text-gray-600">Datasets</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">My Annotation History</h3>
            
            {Object.keys(userAnnotations).length === 0 ? (
              <p className="text-gray-500 text-center py-8">No annotations yet. Start annotating from the dashboard!</p>
            ) : (
              <div className="space-y-6">
                {Object.entries(userAnnotations).map(([datasetId, datasetAnnotations]) => (
                  <div key={datasetId} className="border-l-4 border-blue-500 pl-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="font-semibold text-gray-700 text-lg">{datasets[datasetId]?.name}</h4>
                        <p className="text-sm text-gray-500">{Object.keys(datasetAnnotations).length} records annotated</p>
                      </div>
                      <button
                        onClick={() => handleDatasetSelect(datasetId)}
                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition"
                      >
                        Continue →
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.entries(datasetAnnotations).map(([recordId, annotation]) => (
                        <div key={recordId} className="bg-gray-50 p-3 rounded-lg">
                          <div className="flex justify-between items-start mb-2">
                            <span className="text-sm font-medium text-gray-600">Record: {recordId}</span>
                            <span className={`px-2 py-1 rounded text-xs ${
                              annotation.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {annotation.status}
                            </span>
                          </div>
                          <p className="text-sm text-gray-700 mb-2">{annotation.text}</p>
                          <p className="text-xs text-gray-500">{new Date(annotation.timestamp).toLocaleString()}</p>
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

  // Main render
  if (view === 'login') return renderLogin();
  if (view === 'register') return renderRegister();
  if (view === 'dashboard') return renderDashboard();
  if (view === 'upload') return renderUpload();
  if (view === 'datasets') return renderDatasets();
  if (view === 'annotate') return renderAnnotate();
  if (view === 'review') return renderReview();
  if (view === 'account') return renderAccount();
  
  return null;
};

export default ECGAnnotationPlatform;
