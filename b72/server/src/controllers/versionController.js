const Version = require('../models/Version');
const Annotation = require('../models/Annotation');

const sanitizeSnapshotData = (annotations) => {
  return annotations.map(a => {
    let cleanedData = a.data;
    
    if (typeof cleanedData === 'object' && cleanedData !== null) {
      cleanedData = JSON.parse(JSON.stringify(cleanedData));
    }

    return {
      page: Number(a.page) || 1,
      type: String(a.type),
      data: cleanedData,
      color: String(a.color || '#ff0000'),
      createdBy: a.createdBy,
      createdAt: a.createdAt
    };
  });
};

exports.getVersions = async (req, res) => {
  try {
    const versions = await Version.find({ scoreId: req.params.scoreId })
      .populate('createdBy', 'name email')
      .sort({ version: -1 });

    res.json({ versions });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.createVersion = async (req, res) => {
  try {
    if (req.userRole === 'viewer') {
      return res.status(403).json({ message: '只读用户不能创建版本' });
    }

    const { description } = req.body;

    const annotations = await Annotation.find({ scoreId: req.params.scoreId });
    const sanitizedSnapshot = sanitizeSnapshotData(annotations);

    const lastVersion = await Version.findOne({ scoreId: req.params.scoreId })
      .sort({ version: -1 });

    const newVersion = new Version({
      scoreId: req.params.scoreId,
      version: lastVersion ? lastVersion.version + 1 : 1,
      snapshot: sanitizedSnapshot,
      createdBy: req.user._id,
      description: description || `版本 ${lastVersion ? lastVersion.version + 1 : 1}`
    });

    await newVersion.save();
    await newVersion.populate('createdBy', 'name email');

    res.status(201).json({
      message: '版本创建成功',
      version: newVersion
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.restoreVersion = async (req, res) => {
  try {
    if (req.userRole === 'viewer') {
      return res.status(403).json({ message: '只读用户不能恢复版本' });
    }

    const version = await Version.findById(req.params.id);
    if (!version) {
      return res.status(404).json({ message: '版本不存在' });
    }

    await Annotation.deleteMany({ scoreId: version.scoreId });

    const annotationsToRestore = version.snapshot.map(s => ({
      scoreId: version.scoreId,
      page: Number(s.page) || 1,
      type: String(s.type),
      data: s.data,
      color: String(s.color || '#ff0000'),
      createdBy: s.createdBy
    }));

    const newAnnotations = await Annotation.insertMany(annotationsToRestore);

    await Annotation.populate(newAnnotations, { path: 'createdBy', select: 'name email' });

    res.json({
      message: '版本恢复成功',
      annotations: newAnnotations
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};
