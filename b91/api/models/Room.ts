import mongoose from '../config/database';

const roomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  hostId: { type: String, required: true },
  participants: [{ type: String }],
  hasVoiceprintLock: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

export interface IRoom extends mongoose.Document {
  name: string;
  passwordHash: string;
  hostId: string;
  participants: string[];
  hasVoiceprintLock: boolean;
  createdAt: Date;
}

export const Room = mongoose.model<IRoom>('Room', roomSchema);
export default Room;
