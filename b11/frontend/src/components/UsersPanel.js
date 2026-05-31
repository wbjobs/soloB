import React, { useState } from 'react';
import { useRoomStore } from '../store/roomStore';
import { useAuthStore } from '../store/authStore';
import { roomAPI } from '../services/api';
import { Users, User, Crown, Shield, Eye, MoreVertical, Edit, Settings } from 'lucide-react';

function UsersPanel() {
  const { users, currentRoom, myRole } = useRoomStore();
  const { user } = useAuthStore();
  const [menuUser, setMenuUser] = useState(null);

  const isOwner = myRole === 'owner';

  const handleSetRole = async (targetUserId, role) => {
    if (!isOwner) return;

    try {
      await roomAPI.setRole(currentRoom.id, targetUserId, role);
      setMenuUser(null);
    } catch (err) {
      console.error('Failed to set role:', err);
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'owner':
        return <Crown size={14} className="role-icon owner" />;
      case 'editor':
        return <Edit size={14} className="role-icon editor" />;
      case 'viewer':
        return <Eye size={14} className="role-icon viewer" />;
      default:
        return null;
    }
  };

  const getRoleName = (role) => {
    switch (role) {
      case 'owner':
        return 'Owner';
      case 'editor':
        return 'Editor';
      case 'viewer':
        return 'Viewer';
      default:
        return role;
    }
  };

  return (
    <div className="users-panel">
      <div className="panel-header">
        <h3><Users size={18} /> Online Users ({users.length})</h3>
      </div>

      <div className="users-list">
        {users.map(u => {
          const isSelf = u.id === user?.id;
          const showMenu = isOwner && u.role !== 'owner';

          return (
            <div
              key={u.id}
              className={`user-item ${isSelf ? 'self' : ''}`}
            >
              <div className="user-avatar" style={{ backgroundColor: u.color }}>
                <User size={18} />
              </div>

              <div className="user-info">
                <span className="user-name">
                  {isSelf ? 'You' : `User ${u.id.substring(0, 6)}`}
                  {isSelf && <span className="self-badge">(You)</span>}
                </span>
                <div className="user-role">
                  {getRoleIcon(u.role)}
                  <span>{getRoleName(u.role)}</span>
                </div>
              </div>

              {showMenu && (
                <div className="user-actions">
                  <button
                    className="menu-btn"
                    onClick={() => setMenuUser(menuUser === u.id ? null : u.id)}
                  >
                    <MoreVertical size={16} />
                  </button>

                  {menuUser === u.id && (
                    <div className="role-menu">
                      <button
                        onClick={() => handleSetRole(u.id, 'editor')}
                        className={u.role === 'editor' ? 'active' : ''}
                      >
                        <Edit size={14} />
                        <span>Editor</span>
                      </button>
                      <button
                        onClick={() => handleSetRole(u.id, 'viewer')}
                        className={u.role === 'viewer' ? 'active' : ''}
                      >
                        <Eye size={14} />
                        <span>Viewer</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isOwner && (
        <div className="panel-footer">
          <small>You are the Owner. You can manage user roles.</small>
        </div>
      )}

      {menuUser && (
        <div
          className="menu-backdrop"
          onClick={() => setMenuUser(null)}
        />
      )}
    </div>
  );
}

export default UsersPanel;
