import React from 'react'
import ReactDOM from 'react-dom/client'
import PromptoberApp from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <PromptoberApp />
    </ThemeProvider>
  </React.StrictMode>,
)
