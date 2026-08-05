import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initializeLiveUpdates } from './platform/liveUpdate';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root-Element fehlt.');
createRoot(root).render(<StrictMode><App /></StrictMode>);
void initializeLiveUpdates();
