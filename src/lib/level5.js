import { supabase } from './supabase'

const throwIfError = (error) => {
  if (error) throw error
}

export const level5ProtocolService = {
  async listActive() {
    const { data, error } = await supabase
      .from('annotation_protocols')
      .select('*')
      .eq('status', 'active')
      .order('name')
      .order('version', { ascending: false })
    throwIfError(error)
    return data || []
  },

  async listDiagnosisTerms(category) {
    let query = supabase
      .from('diagnosis_terms')
      .select('*')
      .eq('is_active', true)
      .order('category')
      .order('display_name')
    if (category) query = query.eq('category', category)
    const { data, error } = await query
    throwIfError(error)
    return data || []
  }
}

export const level5AssignmentService = {
  async listMine(status) {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    throwIfError(authError)
    if (!user) return []

    let query = supabase
      .from('annotation_assignments')
      .select(`
        *,
        ecg_record:ecg_record_id (
          id, study_uid, subject_key, quality_status,
          dataset:dataset_id (id, name)
        )
      `)
      .eq('assignee_id', user.id)
      .order('created_at', { ascending: false })
    if (status) query = query.eq('status', status)
    const { data, error } = await query
    throwIfError(error)
    return data || []
  }
}

export const level5SourceService = {
  async listForRecord(recordId) {
    const { data, error } = await supabase
      .from('ecg_sources')
      .select('*')
      .eq('ecg_record_id', recordId)
      .order('is_original', { ascending: false })
      .order('created_at')
    throwIfError(error)
    return data || []
  },

  async register(recordId, source) {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    throwIfError(authError)
    if (!user) throw new Error('Authentication is required')

    const { data, error } = await supabase
      .from('ecg_sources')
      .insert([{
        ecg_record_id: recordId,
        parent_source_id: source.parentSourceId || null,
        source_kind: source.sourceKind,
        storage_bucket: source.storageBucket || null,
        storage_path: source.storagePath || null,
        original_filename: source.originalFilename || null,
        media_type: source.mediaType || null,
        sha256: source.sha256 || null,
        byte_size: source.byteSize ?? null,
        device_manufacturer: source.deviceManufacturer || null,
        device_model: source.deviceModel || null,
        sampling_rate_hz: source.samplingRateHz ?? null,
        amplitude_unit: source.amplitudeUnit || null,
        gain: source.gain || {},
        lead_names: source.leadNames || [],
        is_original: source.isOriginal ?? true,
        metadata: source.metadata || {},
        uploaded_by: user.id
      }])
      .select()
      .single()
    throwIfError(error)
    return data
  }
}

export const level5AnnotationService = {
  async listForRecord(recordId) {
    const { data, error } = await supabase
      .from('annotation_sessions')
      .select(`
        *,
        annotator:annotator_id (id, username, role),
        protocol:protocol_id (id, name, version)
      `)
      .eq('ecg_record_id', recordId)
      .order('created_at', { ascending: false })
    throwIfError(error)
    return data || []
  },

  async createSession(recordId, options = {}) {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    throwIfError(authError)
    if (!user) throw new Error('Authentication is required')

    const { data, error } = await supabase
      .from('annotation_sessions')
      .insert([{
        ecg_record_id: recordId,
        annotator_id: user.id,
        protocol_id: options.protocolId || null,
        parent_session_id: options.parentSessionId || null,
        session_type: options.sessionType || 'primary',
        round_number: options.roundNumber || 1,
        software_version: options.softwareVersion || null
      }])
      .select()
      .single()
    throwIfError(error)
    return data
  },

  async getSessionBundle(sessionId) {
    const [session, beats, waves, rhythms, measurements, diagnoses, imageRegions] = await Promise.all([
      supabase.from('annotation_sessions').select('*').eq('id', sessionId).single(),
      supabase.from('beat_annotations').select('*').eq('session_id', sessionId).order('sample_index'),
      supabase.from('wave_annotations').select('*').eq('session_id', sessionId).order('lead_name').order('beat_sample'),
      supabase.from('rhythm_annotations').select('*').eq('session_id', sessionId).order('start_sample'),
      supabase.from('measurement_annotations').select('*').eq('session_id', sessionId).order('measurement_code'),
      supabase.from('diagnosis_annotations').select('*, term:diagnosis_term_id(*)').eq('session_id', sessionId),
      supabase.from('image_region_annotations').select('*').eq('session_id', sessionId).order('created_at')
    ])
    ;[session, beats, waves, rhythms, measurements, diagnoses, imageRegions].forEach(result => throwIfError(result.error))
    return {
      session: session.data,
      beats: beats.data || [],
      waves: waves.data || [],
      rhythms: rhythms.data || [],
      measurements: measurements.data || [],
      diagnoses: diagnoses.data || [],
      imageRegions: imageRegions.data || []
    }
  },

  async replaceImageRegions(sessionId, regions) {
    const { error } = await supabase.rpc('replace_image_region_annotations', {
      session_uuid: sessionId,
      regions: regions.map(({ label, x, y, width, height }) => ({ label, x, y, width, height }))
    })
    throwIfError(error)
  },

  async addBeat(sessionId, beat) {
    const { data, error } = await supabase.from('beat_annotations').insert([{
      session_id: sessionId,
      sample_index: beat.sampleIndex,
      lead_name: beat.leadName || null,
      beat_type: beat.beatType,
      confidence: beat.confidence ?? null,
      attributes: beat.attributes || {}
    }]).select().single()
    throwIfError(error)
    return data
  },

  async addWave(sessionId, wave) {
    const { data, error } = await supabase.from('wave_annotations').insert([{
      session_id: sessionId,
      lead_name: wave.leadName,
      beat_sample: wave.beatSample ?? null,
      p_onset: wave.pOnset ?? null,
      p_peak: wave.pPeak ?? null,
      p_offset: wave.pOffset ?? null,
      qrs_onset: wave.qrsOnset ?? null,
      q_peak: wave.qPeak ?? null,
      r_peak: wave.rPeak ?? null,
      s_peak: wave.sPeak ?? null,
      qrs_offset: wave.qrsOffset ?? null,
      j_point: wave.jPoint ?? null,
      t_onset: wave.tOnset ?? null,
      t_peak: wave.tPeak ?? null,
      t_offset: wave.tOffset ?? null,
      confidence: wave.confidence ?? null,
      attributes: wave.attributes || {}
    }]).select().single()
    throwIfError(error)
    return data
  },

  async addRhythm(sessionId, rhythm) {
    const { data, error } = await supabase.from('rhythm_annotations').insert([{
      session_id: sessionId,
      start_sample: rhythm.startSample,
      end_sample: rhythm.endSample,
      rhythm_code: rhythm.rhythmCode,
      lead_name: rhythm.leadName || null,
      confidence: rhythm.confidence ?? null,
      attributes: rhythm.attributes || {}
    }]).select().single()
    throwIfError(error)
    return data
  },

  async addMeasurement(sessionId, measurement) {
    const { data, error } = await supabase.from('measurement_annotations').insert([{
      session_id: sessionId,
      measurement_code: measurement.measurementCode,
      value_numeric: measurement.value,
      unit: measurement.unit,
      lead_name: measurement.leadName || null,
      start_sample: measurement.startSample ?? null,
      end_sample: measurement.endSample ?? null,
      method: measurement.method || null,
      confidence: measurement.confidence ?? null,
      attributes: measurement.attributes || {}
    }]).select().single()
    throwIfError(error)
    return data
  },

  async addDiagnosis(sessionId, diagnosis) {
    const { data, error } = await supabase.from('diagnosis_annotations').insert([{
      session_id: sessionId,
      diagnosis_term_id: diagnosis.termId || null,
      code_system: diagnosis.codeSystem || null,
      diagnosis_code: diagnosis.code || null,
      display_text: diagnosis.displayText,
      is_present: diagnosis.isPresent ?? true,
      certainty: diagnosis.certainty || 'definite',
      lead_names: diagnosis.leadNames || [],
      start_sample: diagnosis.startSample ?? null,
      end_sample: diagnosis.endSample ?? null,
      confidence: diagnosis.confidence ?? null,
      attributes: diagnosis.attributes || {}
    }]).select().single()
    throwIfError(error)
    return data
  },

  async submitSession(sessionId) {
    const { data, error } = await supabase
      .rpc('submit_annotation_session', { session_uuid: sessionId })
    throwIfError(error)
    return data
  }
}

export const level5DatasetVersionService = {
  async list(datasetId) {
    const { data, error } = await supabase
      .from('dataset_versions')
      .select('*, records:dataset_version_records(count)')
      .eq('dataset_id', datasetId)
      .order('created_at', { ascending: false })
    throwIfError(error)
    return data || []
  },

  async create(datasetId, version) {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    throwIfError(authError)
    if (!user) throw new Error('Authentication is required')

    const { data, error } = await supabase.from('dataset_versions').insert([{
      dataset_id: datasetId,
      version: version.version,
      protocol_id: version.protocolId || null,
      description: version.description || null,
      inclusion_criteria: version.inclusionCriteria || {},
      exclusion_criteria: version.exclusionCriteria || {},
      split_seed: version.splitSeed ?? null,
      split_strategy: version.splitStrategy || 'patient_level',
      created_by: user.id
    }]).select().single()
    throwIfError(error)
    return data
  },

  async addRecord(versionId, record) {
    const { data, error } = await supabase.from('dataset_version_records').insert([{
      dataset_version_id: versionId,
      ecg_record_id: record.recordId,
      ground_truth_session_id: record.groundTruthSessionId || null,
      split: record.split || 'unassigned',
      subject_key: record.subjectKey
    }]).select().single()
    throwIfError(error)
    return data
  },

  async freeze(versionId, manifestSha256) {
    const { data, error } = await supabase.rpc('freeze_dataset_version', {
      version_uuid: versionId,
      manifest_hash: manifestSha256
    })
    throwIfError(error)
    return data
  }
}
