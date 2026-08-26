import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <HashRouter>
        <App />
      </HashRouter>
    </AuthProvider>
  </StrictMode>,
)
