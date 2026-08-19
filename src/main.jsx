import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { missingCredentials } from './lib/supabase.js'

const MissingConfig = () => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="max-w-md w-full bg-white rounded-lg shadow p-8 text-center">
      <h1 className="text-2xl font-bold text-gray-800 mb-2">Configuration Required</h1>
      <p className="text-gray-600 mb-4">
        Supabase environment variables are not set. Please configure{' '}
        <code className="bg-gray-100 px-1 rounded">VITE_SUPABASE_URL</code> and{' '}
        <code className="bg-gray-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> in your
        deployment environment settings.
      </p>
      <p className="text-sm text-gray-400">See <code>.env.example</code> for details.</p>
    </div>
  </div>
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {missingCredentials ? <MissingConfig /> : <App />}
  </React.StrictMode>,
)
