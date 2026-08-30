import { createRoot } from 'react-dom/client'
import { App } from './app.js'
import './styles.css'

const element = document.getElementById('root')
if (element === null) throw new Error('ORYH AI Client root element is unavailable.')

createRoot(element).render(<App />)
