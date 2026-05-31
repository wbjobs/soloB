class NetworkManager {
  constructor() {
    this.peerConnection = null;
    this.dataChannel = null;
    this.isHost = false;
    this.connected = false;
    this.listeners = {};
  }

  async createHost() {
    this.isHost = true;
    
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    };

    this.peerConnection = new RTCPeerConnection(configuration);
    
    this.dataChannel = this.peerConnection.createDataChannel('voxel-channel', {
      ordered: true
    });

    this.setupDataChannel();
    this.setupPeerConnection();

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    console.log('Host created - offer:', offer.sdp?.substring(0, 100) + '...');
    
    return offer;
  }

  async joinHost(offer) {
    this.isHost = false;
    
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    };

    this.peerConnection = new RTCPeerConnection(configuration);
    
    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel();
    };

    this.setupPeerConnection();

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    console.log('Joined host - answer:', answer.sdp?.substring(0, 100) + '...');
    
    return answer;
  }

  async receiveAnswer(answer) {
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  }

  setupDataChannel() {
    this.dataChannel.onopen = () => {
      console.log('Data channel opened');
      this.connected = true;
      this.emit('connected');
    };

    this.dataChannel.onclose = () => {
      console.log('Data channel closed');
      this.connected = false;
      this.emit('disconnected');
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (e) {
        console.error('Failed to parse message:', e);
      }
    };
  }

  setupPeerConnection() {
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('ICE candidate:', event.candidate.candidate?.substring(0, 50) + '...');
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', this.peerConnection.connectionState);
    };
  }

  handleMessage(message) {
    switch (message.type) {
      case 'chunk-update':
        this.emit('chunk-update', message.data);
        break;
      case 'player-position':
        this.emit('player-position', message.data);
        break;
      case 'chat':
        this.emit('chat', message.data);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  sendMessage(type, data) {
    if (!this.connected || !this.dataChannel) {
      return false;
    }

    try {
      const message = JSON.stringify({ type, data, timestamp: Date.now() });
      this.dataChannel.send(message);
      return true;
    } catch (e) {
      console.error('Failed to send message:', e);
      return false;
    }
  }

  sendChunkUpdate(chunkX, chunkZ, voxelData) {
    return this.sendMessage('chunk-update', {
      chunkX,
      chunkZ,
      voxelData: voxelData.slice(0, 100)
    });
  }

  sendPlayerPosition(position, rotation) {
    return this.sendMessage('player-position', {
      position: Array.from(position),
      rotation
    });
  }

  sendChatMessage(text) {
    return this.sendMessage('chat', { text });
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(callback => callback(data));
    }
  }

  disconnect() {
    if (this.dataChannel) {
      this.dataChannel.close();
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }

  isHosting() {
    return this.isHost;
  }
}

export default NetworkManager;
