import mongoose from '../config/database';

const voiceprintSchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room', required: true },
  userId: { type: String, required: true },
  featureVector: { type: [Number], required: true },
  createdAt: { type: Date, default: Date.now }
});

export interface IVoiceprint extends mongoose.Document {
  roomId: mongoose.Types.ObjectId;
  userId: string;
  featureVector: number[];
  createdAt: Date;
}

export const Voiceprint = mongoose.model<IVoiceprint>('Voiceprint', voiceprintSchema);
export default Voiceprint;
