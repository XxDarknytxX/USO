import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/main.css'; // This line should be present
import App from './App.jsx';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);