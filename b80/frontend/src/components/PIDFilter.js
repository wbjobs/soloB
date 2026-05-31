import React, { useState, useEffect } from 'react';
import axios from 'axios';

const PIDFilter = ({ selectedPID, onSelectPID }) => {
  const [pids, setPids] = useState([]);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    const fetchPIDs = async () => {
      try {
        const response = await axios.get('/api/events');
        const uniquePIDs = [...new Set(response.data.map((item) => item.pid))];
        setPids(uniquePIDs.sort((a, b) => a - b));
      } catch (error) {
        console.error('Error fetching PIDs:', error);
      }
    };

    fetchPIDs();
    const interval = setInterval(fetchPIDs, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleChange = (e) => {
    const value = e.target.value;
    setInputValue(value);
    onSelectPID(value ? parseInt(value) : null);
  };

  return (
    <div style={styles.container}>
      <label style={styles.label}>PID 过滤:</label>
      <select
        style={styles.select}
        value={selectedPID || ''}
        onChange={handleChange}
      >
        <option value="">全部</option>
        {pids.map((pid) => (
          <option key={pid} value={pid}>
            {pid}
          </option>
        ))}
      </select>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  label: {
    fontSize: '0.9rem',
    color: '#888',
  },
  select: {
    backgroundColor: '#1a1a2e',
    color: '#eee',
    border: '1px solid #0f3460',
    borderRadius: '4px',
    padding: '0.5rem',
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
};

export default PIDFilter;
