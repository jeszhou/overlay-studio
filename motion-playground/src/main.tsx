import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { EulaGate } from './EulaGate.tsx'
import { CrashGate } from './CrashGate.tsx'

// ?export=1 → 导出专用纯净视图(透明底,仅动效,供无头浏览器逐帧截图)
const isExport = new URLSearchParams(location.search).get('export') === '1'

const ExportView = lazy(() => import('./ExportView.tsx').then(module => ({default: module.ExportView})))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CrashGate>{isExport ? <Suspense fallback={null}><ExportView /></Suspense> : <EulaGate><App /></EulaGate>}</CrashGate>
  </StrictMode>,
)
