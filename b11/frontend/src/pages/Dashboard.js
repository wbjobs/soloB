import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, Lock, Unlock, LogOut, Code2, FolderPlus, ArrowRight } from 'lucide-react';
import { roomAPI } from '../services/api';
import { useAuthStore } from '../store/authStore';

function Dashboard() {
  const [myRooms, setMyRooms] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const navigate = useNavigate();
  const logout = useAuthStore(state => state.logout);

  useEffect(() => {
    loadRooms();
  }, []);

  const loadRooms = async () => {
    try {
      const response = await roomAPI.getMyRooms();
      setMyRooms(response.data);
    } catch (err) {
      console.error('Failed to load rooms:', err);
    }
  };

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const formData = new FormData(e.target);
    const name = formData.get('name') || 'New Room';
    const password = formData.get('password');

    try {
      const response = await roomAPI.create(name, password || null);
      navigate(`/room/${response.data.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create room');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinRoom = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const formData = new FormData(e.target);
    const roomId = formData.get('roomId').toUpperCase();
    const password = formData.get('password');

    try {
      const response = await roomAPI.join(roomId, password || null);
      navigate(`/room/${response.data.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to join room');
    } finally {
      setLoading(false);
    }
  };

  const enterRoom = (roomId) => {
    navigate(`/room/${roomId}`);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <Code2 size={28} className="logo-icon" />
          <h1>CodeCollab</h1>
        </div>
        <button onClick={handleLogout} className="btn-icon" title="Logout">
          <LogOut size={20} />
        </button>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-actions">
          <button onClick={() => setShowCreateModal(true)} className="btn-primary">
            <Plus size={20} />
            Create Room
          </button>
          <button onClick={() => setShowJoinModal(true)} className="btn-secondary">
            <FolderPlus size={20} />
            Join Room
          </button>
        </div>

        <div className="rooms-section">
          <h2>My Rooms</h2>
          {myRooms.length === 0 ? (
            <div className="empty-state">
              <Users size={48} />
              <p>No rooms yet. Create or join one to start collaborating!</p>
            </div>
          ) : (
            <div className="rooms-grid">
              {myRooms.map(room => (
                <div
                  key={room.id}
                  className="room-card"
                  onClick={() => enterRoom(room.id)}
                >
                  <div className="room-card-header">
                    <h3>{room.name}</h3>
                    {room.role === 'owner' && <span className="owner-badge">Owner</span>}
                  </div>
                  <div className="room-card-meta">
                    <span className="room-id">ID: {room.id}</span>
                    <span className="user-count">
                      <Users size={14} /> {room.userCount}
                    </span>
                  </div>
                  <div className="room-card-footer">
                    <span>Open Room</span>
                    <ArrowRight size={16} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Room</h3>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={handleCreateRoom}>
              <div className="form-group">
                <label>Room Name</label>
                <input name="name" placeholder="My Collaborative Room" required />
              </div>
              <div className="form-group">
                <label>Password (optional)</label>
                <input name="password" type="password" placeholder="Leave empty for public" />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={loading} className="btn-primary">
                  {loading ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Join Room</h3>
            {error && <div className="error-message">{error}</div>}
            <form onSubmit={handleJoinRoom}>
              <div className="form-group">
                <label>Room ID</label>
                <input name="roomId" placeholder="Enter room ID" required />
              </div>
              <div className="form-group">
                <label>Password (if required)</label>
                <input name="password" type="password" placeholder="Room password" />
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowJoinModal(false)} className="btn-secondary">
                  Cancel
                </button>
                <button type="submit" disabled={loading} className="btn-primary">
                  {loading ? 'Joining...' : 'Join'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
