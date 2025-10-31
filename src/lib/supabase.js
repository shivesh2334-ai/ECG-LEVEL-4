
// src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_ecg4_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_ecg4_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials')
  throw new Error('Supabase URL and Anon Key must be provided')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Authentication functions
export const authService = {
  // Sign up new user
  async signUp(email, password, userData) {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    })
    
    if (authError) throw authError
    
    // Create user profile
    const { data, error } = await supabase
      .from('users')
      .insert([{
        id: authData.user.id,
        username: userData.username,
        email: email,
        role: userData.role,
        hospital_name: userData.hospitalName
      }])
      .select()
    
    if (error) throw error
    return data[0]
  },
  
  // Sign in
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    
    if (error) throw error
    
    // Get user profile
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single()
    
    if (userError) throw userError
    return userData
  },
  
  // Sign out
  async signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  },
  
  // Get current user
  async getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()
    
    if (error) throw error
    return data
  }
}

// Dataset functions
export const datasetService = {
  // Get all datasets
  async getDatasets() {
    const { data, error } = await supabase
      .from('datasets')
      .select(`
        *,
        users:uploaded_by (username, hospital_name)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  },
  
  // Create new dataset
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
  
  // Get dataset progress
  async getDatasetProgress(datasetId) {
    const { data, error } = await supabase
      .rpc('get_dataset_progress', { dataset_uuid: datasetId })
    
    if (error) throw error
    return data[0]
  }
}

// ECG Records functions
export const ecgService = {
  // Get ECG records for a dataset
  async getRecords(datasetId) {
    const { data, error } = await supabase
      .from('ecg_records')
      .select('*')
      .eq('dataset_id', datasetId)
      .order('record_number', { ascending: true })
    
    if (error) throw error
    return data
  },
  
  // Get single ECG record with raw data
  async getRecordWithData(recordId) {
    const { data: record, error: recordError } = await supabase
      .from('ecg_records')
      .select('*')
      .eq('id', recordId)
      .single()
    
    if (recordError) throw recordError
    
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
  
  // Upload ECG record
  async uploadRecord(datasetId, recordData) {
    // First, insert metadata
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
    
    // Then, insert raw ECG data
    const { data: rawData, error: rawError } = await supabase
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
    
    if (rawError) throw rawError
    
    return record
  },
  
  // Batch upload multiple records
  async batchUploadRecords(datasetId, records) {
    const results = []
    for (const record of records) {
      try {
        const result = await this.uploadRecord(datasetId, record)
        results.push({ success: true, data: result })
      } catch (error) {
        results.push({ success: false, error: error.message, record })
      }
    }
    return results
  }
}

// Annotation functions
export const annotationService = {
  // Get annotations for a record
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
  
  // Get user's annotation for a record
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
  
  // Create or update annotation
  async saveAnnotation(recordId, userId, annotationData) {
    // Check if annotation exists
    const existing = await this.getUserAnnotation(recordId, userId)
    
    if (existing) {
      // Update existing
      const { data, error } = await supabase
        .from('annotations')
        .update({
          diagnosis: annotationData.diagnosis,
          status: annotationData.status,
          findings: annotationData.findings,
          confidence_score: annotationData.confidenceScore,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single()
      
      if (error) throw error
      
      // Log history
      await this.logAnnotationHistory(existing.id, userId, 'updated', {
        old_diagnosis: existing.diagnosis,
        new_diagnosis: annotationData.diagnosis,
        old_status: existing.status,
        new_status: annotationData.status
      })
      
      return data
    } else {
      // Create new
      const { data, error } = await supabase
        .from('annotations')
        .insert([{
          ecg_record_id: recordId,
          annotator_id: userId,
          diagnosis: annotationData.diagnosis,
          status: annotationData.status,
          findings: annotationData.findings,
          confidence_score: annotationData.confidenceScore
        }])
        .select()
        .single()
      
      if (error) throw error
      
      // Log history
      await this.logAnnotationHistory(data.id, userId, 'created', {
        new_diagnosis: annotationData.diagnosis,
        new_status: annotationData.status
      })
      
      return data
    }
  },
  
  // Review annotation (for experts)
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
  
  // Log annotation history
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
  
  // Get user statistics
  async getUserStats(userId) {
    const { data, error } = await supabase
      .rpc('get_user_annotation_stats', { user_id: userId })
    
    if (error) throw error
    return data[0]
  },
  
  // Get all annotations by user
  async getUserAnnotations(userId) {
    const { data, error } = await supabase
      .from('annotations')
      .select(`
        *,
        ecg_record:ecg_record_id (
          patient_id,
          heart_rate,
          dataset:dataset_id (name)
        )
      `)
      .eq('annotator_id', userId)
      .order('created_at', { ascending: false })
    
    if (error) throw error
    return data
  }
}

// Statistics functions
export const statsService = {
  // Get platform statistics
  async getPlatformStats() {
    const { data: datasets } = await supabase
      .from('datasets')
      .select('id')
    
    const { data: records } = await supabase
      .from('ecg_records')
      .select('id')
    
    const { data: users } = await supabase
      .from('users')
      .select('id')
    
    const { data: annotations } = await supabase
      .from('annotations')
      .select('id')
    
    return {
      totalDatasets: datasets?.length || 0,
      totalRecords: records?.length || 0,
      totalUsers: users?.length || 0,
      totalAnnotations: annotations?.length || 0
    }
  },
  
  // Get recent activity
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
