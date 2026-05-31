const Score = require('../models/Score');

const checkPermission = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const scoreId = req.params.id || req.params.scoreId;
      const score = await Score.findById(scoreId);
      
      if (!score) {
        return res.status(404).json({ message: '乐谱不存在' });
      }

      const collaborator = score.collaborators.find(
        c => c.userId.toString() === req.user._id.toString()
      );

      if (!collaborator) {
        return res.status(403).json({ message: '没有访问权限' });
      }

      if (!allowedRoles.includes(collaborator.role)) {
        return res.status(403).json({ message: '权限不足' });
      }

      req.score = score;
      req.userRole = collaborator.role;
      next();
    } catch (error) {
      res.status(500).json({ message: '服务器错误', error: error.message });
    }
  };
};

module.exports = checkPermission;
