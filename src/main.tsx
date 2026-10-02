import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { preloadCards } from './ui/CardView';
import '@fontsource/balsamiq-sans/cyrillic-400.css';
import '@fontsource/balsamiq-sans/cyrillic-700.css';
import '@fontsource/balsamiq-sans/latin-400.css';
import '@fontsource/balsamiq-sans/latin-700.css';
import './styles.css';

preloadCards();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
