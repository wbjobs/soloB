import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import useStore from './store';
import Login from './pages/Login';
import Register from './pages/Register';
import ScoreList from './pages/ScoreList';
import ScoreEditor from './pages/ScoreEditor';
import ProtectedRoute from './components/ProtectedRoute';
import Header from './components/Header';

function App() {
  const { token, fetchMe } = useStore();

  useEffect(() => {
    if (token) {
      fetchMe();
    }
  }, [token, fetchMe]);

  return (
    <div className="min-h-screen bg-light">
      <Header />
      <Routes>
        <Route path="/login" element={token ? <Navigate to="/" /> : <Login />} />
        <Route path="/register" element={token ? <Navigate to="/" /> : <Register />} />
        <Route path="/" element={
          <ProtectedRoute>
            <ScoreList />
          </ProtectedRoute>
        } />
        <Route path="/score/:id" element={
          <ProtectedRoute>
            <ScoreEditor />
          </ProtectedRoute>
        } />
      </Routes>
    </div>
  );
}

export default App;
