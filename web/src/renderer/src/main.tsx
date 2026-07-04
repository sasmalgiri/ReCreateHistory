import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './lib/auth'
import { AuthGate } from './components/AuthGate'
import './assets/main.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <HashRouter>
        <AuthGate>
          <App />
        </AuthGate>
      </HashRouter>
    </AuthProvider>
  </React.StrictMode>
)
