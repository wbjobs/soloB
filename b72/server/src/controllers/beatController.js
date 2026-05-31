const BeatDetector = require('../utils/beatDetector');
const Annotation = require('../models/Annotation');
const Score = require('../models/Score');

const beatDetector = new BeatDetector();

exports.detectBeats = async (req, res) => {
  try {
    const { scoreId, page = 1 } = req.params;

    const score = await Score.findById(scoreId);
    if (!score) {
      return res.status(404).json({ message: '乐谱不存在' });
    }

    const hasAccess = score.collaborators.some(
      c => c.userId.toString() === req.user._id.toString()
    );
    if (!hasAccess) {
      return res.status(403).json({ message: '没有访问权限' });
    }

    const result = await beatDetector.detectBeatsFromPdf(score.filePath, parseInt(page));

    res.json({
      message: '节拍识别完成',
      timeSignature: result.timeSignature,
      barCount: result.barCount,
      staffCount: result.staffCount,
      marks: result.marks,
      success: result.success
    });
  } catch (error) {
    res.status(500).json({
      message: '节拍识别失败',
      error: error.message
    });
  }
};

exports.applyBeatMarks = async (req, res) => {
  try {
    const { scoreId, page = 1 } = req.params;
    const { marks, timeSignature } = req.body;

    if (req.userRole === 'viewer') {
      return res.status(403).json({ message: '只读用户不能添加节拍标记' });
    }

    const existingMarks = await Annotation.find({
      scoreId,
      page: parseInt(page),
      type: 'metronome'
    });

    const existingIds = existingMarks.map(m => m._id);
    await Annotation.deleteMany({ _id: { $in: existingIds } });

    const annotations = [];
    for (const mark of marks) {
      const annotation = new Annotation({
        scoreId,
        page: parseInt(page),
        type: 'metronome',
        data: {
          x: mark.x,
          y: mark.y,
          barNumber: mark.barNumber,
          beatNumber: mark.beatNumber,
          isAccent: mark.isAccent
        },
        color: mark.isAccent ? '#ff4444' : '#4488ff',
        createdBy: req.user._id
      });
      await annotation.save();
      await annotation.populate('createdBy', 'name email');
      annotations.push(annotation);
    }

    res.status(201).json({
      message: '节拍标记已应用',
      timeSignature,
      annotations,
      count: annotations.length
    });
  } catch (error) {
    res.status(500).json({
      message: '应用节拍标记失败',
      error: error.message
    });
  }
};

exports.getBeatMarks = async (req, res) => {
  try {
    const { scoreId, page = 1 } = req.params;

    const annotations = await Annotation.find({
      scoreId,
      page: parseInt(page),
      type: 'metronome'
    }).populate('createdBy', 'name email');

    res.json({
      annotations
    });
  } catch (error) {
    res.status(500).json({
      message: '获取节拍标记失败',
      error: error.message
    });
  }
};

exports.updateBeatMark = async (req, res) => {
  try {
    if (req.userRole === 'viewer') {
      return res.status(403).json({ message: '只读用户不能修改节拍标记' });
    }

    const { id } = req.params;
    const { data, color } = req.body;

    const annotation = await Annotation.findById(id);
    if (!annotation || annotation.type !== 'metronome') {
      return res.status(404).json({ message: '节拍标记不存在' });
    }

    if (data) annotation.data = data;
    if (color) annotation.color = color;

    await annotation.save();
    await annotation.populate('createdBy', 'name email');

    res.json({
      message: '节拍标记已更新',
      annotation
    });
  } catch (error) {
    res.status(500).json({
      message: '更新节拍标记失败',
      error: error.message
    });
  }
};
