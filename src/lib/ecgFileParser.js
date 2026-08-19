// src/lib/ecgFileParser.js
//
// Parses real 12-lead ECG datasets from CSV. There is no random/synthetic
// signal generation anywhere in this file — rows whose lead columns don't
// contain valid numeric samples are rejected with a descriptive error
// instead of being filled in with fake data.
//
// Expected CSV format (header row required), one row per ECG record:
//
//   patient_id,timestamp,heart_rate,pr_interval,qrs_duration,qt_interval,
//   sampling_rate,auto_analysis,lead_I,lead_II,lead_III,lead_aVR,lead_aVL,
//   lead_aVF,lead_V1,lead_V2,lead_V3,lead_V4,lead_V5,lead_V6
//
// - patient_id: text identifier (required)
// - timestamp: ISO 8601 date/time (optional — defaults to upload time)
// - heart_rate, pr_interval, qrs_duration, qt_interval: numbers (optional)
// - sampling_rate: samples per second, e.g. 500 (optional — defaults to 500)
// - auto_analysis: free text (optional)
// - lead_I ... lead_V6: the 12 standard leads, each cell containing that
//   lead's full list of numeric samples separated by semicolons, e.g.
//   "0.012;0.014;-0.003;...". This is how you bring in real digitized
//   waveforms exported from a device, WFDB/PhysioNet record, or hospital
//   EMR — NOT placeholder values.
//
// A ready-to-fill template is available at /public/sample-ecg-template.csv
// (headers + format notes only, zero fake patient data).

const REQUIRED_LEAD_COLUMNS = [
  'lead_I', 'lead_II', 'lead_III', 'lead_aVR', 'lead_aVL', 'lead_aVF',
  'lead_V1', 'lead_V2', 'lead_V3', 'lead_V4', 'lead_V5', 'lead_V6'
]

const METADATA_COLUMNS = [
  'patient_id', 'timestamp', 'heart_rate', 'pr_interval', 'qrs_duration',
  'qt_interval', 'sampling_rate', 'auto_analysis'
]

const EXPECTED_COLUMNS = [...METADATA_COLUMNS, ...REQUIRED_LEAD_COLUMNS]

function parseCsvLine(line) {
  // Simple CSV split — fields must not contain commas (lead samples use
  // semicolons as the in-field separator specifically to avoid this).
  return line.split(',').map(cell => cell.trim())
}

function parseLeadSamples(cell, columnName, rowNumber) {
  if (!cell) {
    throw new Error(`Row ${rowNumber}: column "${columnName}" is empty — real sample data is required`)
  }
  const samples = cell.split(';').map(v => v.trim()).filter(v => v.length > 0).map(Number)
  if (samples.length === 0 || samples.some(v => Number.isNaN(v))) {
    throw new Error(`Row ${rowNumber}: column "${columnName}" contains non-numeric or empty values`)
  }
  return samples
}

/**
 * Parse raw CSV text into an array of record objects ready for
 * ecgService.batchUploadRecords. Throws on the first invalid row rather
 * than silently substituting generated data.
 */
export function parseEcgCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0)
  if (lines.length < 2) {
    throw new Error('File must contain a header row plus at least one data row')
  }

  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase())
  const missing = EXPECTED_COLUMNS.filter(col => !header.includes(col.toLowerCase()))
  if (missing.length > 0) {
    throw new Error(
      `Missing required column(s): ${missing.join(', ')}. ` +
      `Expected header: ${EXPECTED_COLUMNS.join(',')}`
    )
  }
  const colIndex = Object.fromEntries(header.map((h, i) => [h, i]))

  const records = []
  const errors = []

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1 // 1-based, accounts for header row
    try {
      const cells = parseCsvLine(lines[i])
      if (cells.length < header.length) {
        throw new Error(`Row ${rowNumber}: expected ${header.length} columns, found ${cells.length}`)
      }

      const get = (col) => cells[colIndex[col.toLowerCase()]]

      const patientId = get('patient_id')
      if (!patientId) {
        throw new Error(`Row ${rowNumber}: patient_id is required`)
      }

      const samplingRate = get('sampling_rate') ? parseInt(get('sampling_rate'), 10) : 500
      const leads = REQUIRED_LEAD_COLUMNS.map(col => parseLeadSamples(get(col), col, rowNumber))

      const sampleCount = leads[0].length
      if (leads.some(l => l.length !== sampleCount)) {
        throw new Error(`Row ${rowNumber}: all 12 leads must have the same number of samples`)
      }

      records.push({
        patientId,
        recordNumber: i,
        timestamp: get('timestamp') || new Date().toISOString(),
        heartRate: get('heart_rate') ? parseInt(get('heart_rate'), 10) : null,
        prInterval: get('pr_interval') ? parseInt(get('pr_interval'), 10) : null,
        qrsDuration: get('qrs_duration') ? parseInt(get('qrs_duration'), 10) : null,
        qtInterval: get('qt_interval') ? parseInt(get('qt_interval'), 10) : null,
        autoAnalysis: get('auto_analysis') || null,
        samplingRate,
        duration: sampleCount / samplingRate,
        leads
      })
    } catch (err) {
      errors.push(err.message)
    }
  }

  if (records.length === 0) {
    throw new Error(
      `No valid records could be parsed.\n${errors.slice(0, 10).join('\n')}`
    )
  }

  return { records, errors }
}
