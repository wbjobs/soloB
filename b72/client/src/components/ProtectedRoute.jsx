import React from 'react';
import { Navigate } from 'react-router-dom';
import useStore from '../store';

function ProtectedRoute({ children }) {
  const { token } = useStore();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default ProtectedRoute;
