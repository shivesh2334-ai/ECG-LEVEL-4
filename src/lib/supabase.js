// src/lib/supabase.js
//
// Supabase client + data-access layer for LabelECG.
// This is the ONLY place ECG data is read from / written to — there is
// no local/sample data generator anywhere else in the app.
//
// Required environment variables (see .env.example):
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY
//
// NOTE: this is a Vite project (see vite.config.js), so env vars must be
// prefixed with VITE_ and read via import.meta.env — NOT process.env / the
// Next.js NEXT_PUBLIC_ convention that was here before.

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const missingCredentials = !supabaseUrl || !supabaseAnonKey

if (missingCredentials) {
  console.error(
    'Missing Supabase credentials. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
    'in your deployment environment variables (see .env.example).'
  )
}

export const supabase = missingCredentials
  ? null
  : createClient(supabaseUrl, supabaseAnonKey)

const profileForAuthUser = (user) => {
  const metadata = user.user_metadata || {}
  const emailName = (user.email || 'annotator').split('@')[0]

  return {
    id: user.id,
    username: `${metadata.username || emailName}-${user.id.slice(0, 6)}`,
    email: user.email,
    role: 'annotator',
    hospital_name: metadata.hospital_name || null
  }
}

// Authentication and application profiles live in separate Supabase tables.
// Accounts created before the profile trigger was installed can therefore be
// valid Auth users without a public.users row. Repair those accounts on login;
// the RLS policy only permits a signed-in user to insert their own profile.
const getOrCreateUserProfile = async (user) => {
  const { data: existing, error: selectError } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (selectError) throw selectError
  if (existing) return existing

  const { data: created, error: insertError } = await supabase
    .from('users')
    .insert([profileForAuthUser(user)])
    .select()
    .single()

  if (insertError) {
    throw new Error(
      `Your identity was verified, but the application profile could not be created: ${insertError.message}`
    )
  }

  return created
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
export const authService = {
  // Sign up new user
  async signUp(email, password, userData) {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: {
        username: userData.username,
        role: userData.role || 'annotator',
        hospital_name: userData.hospitalName || ''
      }}
    })

    if (authError) throw authError

    return authData.user
  },

  // Sign in
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error

    return getOrCreateUserProfile(data.user)
  },

  // Send a passwordless email Magic Link to an existing account.
  // shouldCreateUser:false keeps registration an explicit, separate action.
  async signInWithMagicLink(email, redirectTo = window.location.origin) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: false
      }
    })

    if (error) throw error
  },

  // Send a password recovery link to an existing account.
  async sendPasswordReset(email, redirectTo = `${window.location.origin}/?password-recovery=1`) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) throw error
  },

  // Change the password for the temporary recovery session.
  async updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
  },

  // Sign out
  async signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },

  // Get current session's user profile (null if not signed in)
  async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    return getOrCreateUserProfile(user)
  }
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------
export const datasetService = {
  // Get all active datasets, with uploader info and a real record count
  async getDatasets() {
    const { data, error } = await supabase
      .from('datasets')
      .select(`
        *,
        users:uploaded_by (username, hospital_name),
        ecg_records(count)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (error) throw error

    return (data || []).map(ds => ({
      ...ds,
      record_count: ds.ecg_records?.[0]?.count ?? 0
    }))
  },

  // Create a new dataset (metadata row only — records are added separately)
  async createDataset(datasetData, userId) {
    const { data, error } = await supabase
      .from('datasets')
      .insert([{
        name: datasetData.name,
        description: datasetData.description,
        uploaded_by: userId,
        metadata: datasetData.metadata || {}
      }])
      .select()
      .single()

    if (error) throw error
    return data
  },

  // Progress (annotated vs total) for one dataset, via SQL function
  async getDatasetProgress(datasetId) {
    const { data, error } = await supabase
      .rpc('get_dataset_progress', { dataset_uuid: datasetId })

    if (error) throw error
    return data[0]
  },

  // Per-annotator coverage for one dataset — used by the Review screen
  async getDatasetAnnotationSummary(datasetId) {
    const { data, error } = await supabase
      .rpc('get_dataset_annotator_summary', { dataset_uuid: datasetId })

    if (error) throw error
    return data
  },
}

// ---------------------------------------------------------------------------
// ECG records (metadata) + raw waveform data
// ---------------------------------------------------------------------------
export const ecgService = {
  // Lightweight list of records for a dataset (NO waveform data — keeps the
  // dataset browser fast even for large real-world datasets)
  async getRecords(datasetId) {
    const { data, error } = await supabase
      .from('ecg_records')
      .select('*')
      .eq('dataset_id', datasetId)
      .order('record_number', { ascending: true })

    if (error) throw error
    return data
  },

  // Fetch one record's metadata + its full 12-lead waveform, on demand
  async getRecordWithData(recordId) {
    const { data: record, error: recordError } = await supabase
      .from('ecg_records')
      .select('*')
      .eq('id', recordId)
      .single()

    if (recordError) throw recordError

    if (record.source_type === 'image' || record.image_path) {
      if (!record.image_path) {
        throw new Error('This image ECG record has no stored image path')
      }
      const { data: signed, error: signedError } = await supabase.storage
        .from('ecg-images')
        .createSignedUrl(record.image_path, 3600)
      if (signedError) {
        throw new Error(`Could not open the ECG image: ${signedError.message}`)
      }
      return { ...record, source_type: 'image', imageUrl: signed.signedUrl, leads: null }
    }

    const { data: rawData, error: rawError } = await supabase
      .from('ecg_raw_data')
      .select('*')
      .eq('ecg_record_id', recordId)
      .single()

    if (rawError) throw rawError

    return {
      ...record,
      leads: {
        I: rawData.lead_i,
        II: rawData.lead_ii,
        III: rawData.lead_iii,
        aVR: rawData.lead_avr,
        aVL: rawData.lead_avl,
        aVF: rawData.lead_avf,
        V1: rawData.lead_v1,
        V2: rawData.lead_v2,
        V3: rawData.lead_v3,
        V4: rawData.lead_v4,
        V5: rawData.lead_v5,
        V6: rawData.lead_v6
      },
      samplingRate: rawData.sampling_rate,
      duration: rawData.duration
    }
  },

  async uploadImageRecord(datasetId, file, recordData = {}) {
    if (!file?.type?.startsWith('image/')) {
      throw new Error(`${file?.name || 'File'} is not a supported ECG image. Use PNG, JPEG, WebP, or TIFF.`)
    }
    const extension = (file.name.split('.').pop() || 'bin').toLowerCase()
    const storagePath = `${datasetId}/${crypto.randomUUID()}.${extension}`
    const { error: storageError } = await supabase.storage
      .from('ecg-images')
      .upload(storagePath, file, { contentType: file.type, upsert: false })
    if (storageError) throw storageError

    const { data, error } = await supabase.from('ecg_records').insert([{
      dataset_id: datasetId,
      patient_id: recordData.patientId || file.name.replace(/\.[^.]+$/, ''),
      record_number: recordData.recordNumber,
      timestamp: recordData.timestamp || new Date(file.lastModified || Date.now()).toISOString(),
      source_type: 'image',
      image_path: storagePath,
      image_mime_type: file.type,
      image_original_name: file.name,
      metadata: { file_size: file.size, ...(recordData.metadata || {}) }
    }]).select().single()

    if (error) {
      await supabase.storage.from('ecg-images').remove([storagePath])
      throw error
    }
    return data
  },

  async batchUploadImages(datasetId, files, onProgress) {
    const results = []
    for (let i = 0; i < files.length; i++) {
      try {
        const data = await this.uploadImageRecord(datasetId, files[i], { recordNumber: i + 1 })
        results.push({ success: true, data })
      } catch (error) {
        results.push({ success: false, error: error.message, file: files[i].name })
      }
      onProgress?.(i + 1, files.length)
    }
    return results
  },

  // Insert one real ECG record (metadata + 12 lead sample arrays).
  // recordData.leads must be an array of 12 arrays of numeric samples —
  // there is no synthetic/random fallback here.
  async uploadRecord(datasetId, recordData) {
    const { data: record, error: recordError } = await supabase
      .from('ecg_records')
      .insert([{
        dataset_id: datasetId,
        patient_id: recordData.patientId,
        record_number: recordData.recordNumber,
        timestamp: recordData.timestamp,
        heart_rate: recordData.heartRate,
        pr_interval: recordData.prInterval,
        qrs_duration: recordData.qrsDuration,
        qt_interval: recordData.qtInterval,
        auto_analysis: recordData.autoAnalysis,
        metadata: recordData.metadata || {}
      }])
      .select()
      .single()

    if (recordError) throw recordError

    const { error: rawError } = await supabase
      .from('ecg_raw_data')
      .insert([{
        ecg_record_id: record.id,
        lead_i: recordData.leads[0],
        lead_ii: recordData.leads[1],
        lead_iii: recordData.leads[2],
        lead_avr: recordData.leads[3],
        lead_avl: recordData.leads[4],
        lead_avf: recordData.leads[5],
        lead_v1: recordData.leads[6],
        lead_v2: recordData.leads[7],
        lead_v3: recordData.leads[8],
        lead_v4: recordData.leads[9],
        lead_v5: recordData.leads[10],
        lead_v6: recordData.leads[11],
        sampling_rate: recordData.samplingRate || 500,
        duration: recordData.duration
      }])

    if (rawError) {
      // Roll back the orphaned metadata row if the waveform insert failed
      await supabase.from('ecg_records').delete().eq('id', record.id)
      throw rawError
    }

    return record
  },

  // Batch upload multiple real records parsed from an uploaded file.
  // onProgress(current, total) is optional, for large-dataset upload UIs.
  async batchUploadRecords(datasetId, records, onProgress) {
    const results = []
    for (let i = 0; i < records.length; i++) {
      try {
        const result = await this.uploadRecord(datasetId, records[i])
        results.push({ success: true, data: result })
      } catch (error) {
        results.push({ success: false, error: error.message, record: records[i] })
      }
      if (onProgress) onProgress(i + 1, records.length)
    }
    return results
  }
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------
export const annotationService = {
  // All annotations for a record (every annotator + reviewer)
  async getAnnotations(recordId) {
    const { data, error } = await supabase
      .from('annotations')
      .select(`
        *,
        annotator:annotator_id (username, role, hospital_name),
        reviewer:reviewed_by (username, role)
      `)
      .eq('ecg_record_id', recordId)

    if (error) throw error
    return data
  },

  // The signed-in user's own annotation for a record (or null)
  async getUserAnnotation(recordId, userId) {
    const { data, error } = await supabase
      .from('annotations')
      .select('*')
      .eq('ecg_record_id', recordId)
      .eq('annotator_id', userId)
      .maybeSingle()

    if (error) throw error
    return data
  },

  // Create or update the signed-in user's annotation for a record
  async saveAnnotation(recordId, userId, annotationData) {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) throw authError
    if (!user || user.id !== userId) throw new Error('Your sign-in session is no longer valid')

    const existing = await this.getUserAnnotation(recordId, userId)
    const payload = {
      ecg_record_id: recordId,
      annotator_id: userId,
      diagnosis: annotationData.diagnosis?.trim() || null,
      status: annotationData.status,
      findings: annotationData.findings?.trim() || null,
      confidence_score: annotationData.confidenceScore,
      image_marks: annotationData.imageMarks || [],
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('annotations')
      .upsert(payload, { onConflict: 'ecg_record_id,annotator_id' })
      .select()
      .single()

    if (error) {
      throw new Error(`Annotation could not be stored: ${error.message}`)
    }

    try {
      await this.logAnnotationHistory(data.id, userId, existing ? 'updated' : 'created', {
        old_diagnosis: existing?.diagnosis,
        new_diagnosis: data.diagnosis,
        old_status: existing?.status,
        new_status: data.status
      })
    } catch (historyError) {
      // The annotation is already durable. Do not tell the clinician it failed
      // merely because the secondary audit insert was unavailable.
      console.warn('Annotation saved but history logging failed:', historyError)
    }

    return data
  },

  // Review an annotation (expert/admin only — also enforced by RLS)
  async reviewAnnotation(annotationId, reviewerId, reviewNotes) {
    const { data, error } = await supabase
      .from('annotations')
      .update({
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes,
        status: 'reviewed'
      })
      .eq('id', annotationId)
      .select()
      .single()

    if (error) throw error

    await this.logAnnotationHistory(annotationId, reviewerId, 'reviewed', {
      new_status: 'reviewed'
    })

    return data
  },

  async logAnnotationHistory(annotationId, userId, action, changes) {
    const { error } = await supabase
      .from('annotation_history')
      .insert([{
        annotation_id: annotationId,
        user_id: userId,
        action: action,
        old_diagnosis: changes.old_diagnosis,
        new_diagnosis: changes.new_diagnosis,
        old_status: changes.old_status,
        new_status: changes.new_status
      }])

    if (error) throw error
  },

  async getUserStats(userId) {
    const { data, error } = await supabase
      .rpc('get_user_annotation_stats', { user_id: userId })

    if (error) throw error
    return data[0]
  },

  async getUserAnnotations(userId) {
    const { data, error } = await supabase
      .from('annotations')
      .select(`
        *,
        ecg_record:ecg_record_id (
          patient_id,
          heart_rate,
          dataset:dataset_id (id, name)
        )
      `)
      .eq('annotator_id', userId)
      .order('created_at', { ascending: false })

    if (error) throw error
    return data
  }
}

// ---------------------------------------------------------------------------
// Platform-wide statistics
// ---------------------------------------------------------------------------
export const statsService = {
  async getPlatformStats() {
    const [{ count: datasetCount }, { count: recordCount }, { count: userCount }, { count: annotationCount }] =
      await Promise.all([
        supabase.from('datasets').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('ecg_records').select('id', { count: 'exact', head: true }),
        supabase.from('users').select('id', { count: 'exact', head: true }),
        supabase.from('annotations').select('id', { count: 'exact', head: true })
      ])

    return {
      totalDatasets: datasetCount || 0,
      totalRecords: recordCount || 0,
      totalUsers: userCount || 0,
      totalAnnotations: annotationCount || 0
    }
  },

  async getRecentActivity(limit = 10) {
    const { data, error } = await supabase
      .from('annotations')
      .select(`
        *,
        annotator:annotator_id (username),
        ecg_record:ecg_record_id (
          patient_id,
          dataset:dataset_id (name)
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return data
  }
}
