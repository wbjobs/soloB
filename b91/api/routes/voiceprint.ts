import express from 'express';
import Voiceprint from '../models/Voiceprint';
import Room from '../models/Room';

const router = express.Router();

const cosineSimilarity = (vec1: number[], vec2: number[]): number => {
  if (vec1.length !== vec2.length) return 0;
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  return isNaN(similarity) ? 0 : similarity;
};

router.post('/register', async (req, res) => {
  try {
    const { roomId, userId, features } = req.body;
    
    if (!roomId || !userId || !features) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    await Voiceprint.findOneAndDelete({ roomId, userId });

    const voiceprint = new Voiceprint({
      roomId,
      userId,
      featureVector: features
    });

    await voiceprint.save();

    await Room.findByIdAndUpdate(roomId, { hasVoiceprintLock: true });

    res.json({ success: true });
  } catch (error) {
    console.error('Register voiceprint error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { roomId, userId, features } = req.body;
    
    if (!roomId || !userId || !features) {
      return res.status(400).json({ match: false, similarity: 0 });
    }

    const voiceprint = await Voiceprint.findOne({ roomId, userId });
    
    if (!voiceprint) {
      return res.json({ match: false, similarity: 0, message: 'No voiceprint registered' });
    }

    const similarity = cosineSimilarity(features, voiceprint.featureVector);
    
    const threshold = 0.85;
    const isMatch = similarity >= threshold;

    res.json({ 
      match: isMatch, 
      similarity: Math.round(similarity * 100) / 100 
    });
  } catch (error) {
    console.error('Verify voiceprint error:', error);
    res.status(500).json({ match: false, similarity: 0 });
  }
});

export default router;
