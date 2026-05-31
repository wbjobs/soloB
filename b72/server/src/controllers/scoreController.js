const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const Score = require('../models/Score');
const Annotation = require('../models/Annotation');
const Version = require('../models/Version');
const User = require('../models/User');

exports.getScores = async (req, res) => {
  try {
    const scores = await Score.find({
      'collaborators.userId': req.user._id
    }).populate('collaborators.userId', 'name email');

    res.json({ scores });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.uploadScore = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请上传 PDF 文件' });
    }

    const title = req.body.title || req.file.originalname.replace('.pdf', '');
    
    let pageCount = 1;
    try {
      const dataBuffer = fs.readFileSync(req.file.path);
      const pdfData = await pdfParse(dataBuffer);
      pageCount = pdfData.numpages || 1;
    } catch (e) {
      console.log('PDF 解析失败，使用默认页数');
    }

    const score = new Score({
      title,
      fileName: req.file.originalname,
      filePath: req.file.path,
      fileSize: req.file.size,
      pageCount,
      createdBy: req.user._id,
      collaborators: [{
        userId: req.user._id,
        role: 'creator'
      }]
    });

    await score.save();
    
    await Version.create({
      scoreId: score._id,
      version: 1,
      snapshot: [],
      createdBy: req.user._id,
      description: '初始版本'
    });

    await score.populate('collaborators.userId', 'name email');

    res.status(201).json({
      message: '上传成功',
      score
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.getScore = async (req, res) => {
  try {
    await req.score.populate('collaborators.userId', 'name email');
    res.json({ score: req.score });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.deleteScore = async (req, res) => {
  try {
    if (req.userRole !== 'creator') {
      return res.status(403).json({ message: '只有创建者可以删除乐谱' });
    }

    if (fs.existsSync(req.score.filePath)) {
      fs.unlinkSync(req.score.filePath);
    }

    await Annotation.deleteMany({ scoreId: req.score._id });
    await Version.deleteMany({ scoreId: req.score._id });
    await Score.findByIdAndDelete(req.score._id);

    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.shareScore = async (req, res) => {
  try {
    const { email, role } = req.body;
    
    const targetUser = await User.findOne({ email });
    if (!targetUser) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const existingCollaborator = req.score.collaborators.find(
      c => c.userId.toString() === targetUser._id.toString()
    );

    if (existingCollaborator) {
      existingCollaborator.role = role;
    } else {
      req.score.collaborators.push({
        userId: targetUser._id,
        role
      });
    }

    await req.score.save();
    await req.score.populate('collaborators.userId', 'name email');

    res.json({
      message: '分享成功',
      score: req.score
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};
