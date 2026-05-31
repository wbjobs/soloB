import React, { useState, useCallback } from 'react';
import ShaderEditor from './components/ShaderEditor.jsx';
import ShaderPreview from './components/ShaderPreview.jsx';
import { useShareDB } from './hooks/useShareDB.js';

function App() {
  const {
    code,
    setCode,
    isConnected,
    isLoading,
    isRemoteChangeRef,
  } = useShareDB('default');
  
  const [shaderErrors, setShaderErrors] = useState([]);

  const handleErrors = useCallback((errors) => {
    setShaderErrors(errors);
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>Shader Collab</h1>
        <div className="status">
          <span className={`status-dot ${!isConnected ? 'disconnected' : ''}`}></span>
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          {shaderErrors.length > 0 && (
            <span style={{ marginLeft: '12px', color: '#f44747' }}>
              {shaderErrors.length} error{shaderErrors.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>
      
      <div className="main-content">
        <div className="editor-panel">
          <div className="panel-header">GLSL Fragment Shader</div>
          {isLoading ? (
            <div className="loading-overlay">
              <div className="spinner"></div>
              <span>Loading document...</span>
            </div>
          ) : (
            <ShaderEditor
              code={code}
              onCodeChange={setCode}
              isRemoteChangeRef={isRemoteChangeRef}
              errors={shaderErrors}
            />
          )}
        </div>
        
        <div className="preview-panel">
          <div className="panel-header">Preview</div>
          {isLoading ? (
            <div className="loading-overlay">
              <div className="spinner"></div>
              <span>Initializing renderer...</span>
            </div>
          ) : (
            <ShaderPreview 
              code={code} 
              onErrors={handleErrors}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
