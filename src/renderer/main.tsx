import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initWebAudioStudioFallback } from './webAudioStudioFallback';
import './styles/app.css';

initWebAudioStudioFallback();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
