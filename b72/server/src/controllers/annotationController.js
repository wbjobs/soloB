const Annotation = require('../models/Annotation');
const Version = require('../models/Version');

const sanitizeFabricData = (type, data) => {
  if (!data) return {};

  const cleanedData = JSON.parse(JSON.stringify(data));

  switch (type) {
    case 'highlight':
      return {
        left: Number(cleanedData.left) || 0,
        top: Number(cleanedData.top) || 0,
        width: Number(cleanedData.width) || 0,
        height: Number(cleanedData.height) || 0
      };

    case 'pen':
      return {
        path: String(cleanedData.path || cleanedData.d || ''),
        left: Number(cleanedData.left) || 0,
        top: Number(cleanedData.top) || 0
      };

    case 'text':
      return {
        left: Number(cleanedData.left) || 0,
        top: Number(cleanedData.top) || 0,
        text: String(cleanedData.text || '')
      };

    case 'metronome':
      return {
        left: Number(cleanedData.left) || 0,
        top: Number(cleanedData.top) || 0
      };

    default:
      return cleanedData;
  }
};

exports.getAnnotations = async (req, res) => {
  try {
    const { page } = req.query;
    const query = { scoreId: req.params.scoreId };
    
    if (page) {
      query.page = parseInt(page);
    }

    const annotations = await Annotation.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: 1 });

    res.json({ annotations });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.addAnnotation = async (req, res) => {
  try {
    if (req.userRole === 'viewer') {
      return res.status(403).json({ message: '只读用户不能添加批注' });
    }

    const { page, type, data, color } = req.body;

    const sanitizedData = sanitizeFabricData(type, data);

    const annotation = new Annotation({
      scoreId: req.params.scoreId,
      page: parseInt(page) || 1,
      type,
      data: sanitizedData,
      color: String(color || '#ff0000'),
      createdBy: req.user._id
    });

    await annotation.save();
    await annotation.populate('createdBy', 'name email');

    res.status(201).json({
      message: '添加成功',
      annotation
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.updateAnnotation = async (req, res) => {
  try {
    if (req.userRole === 'viewer') {
      return res.status(403).json({ message: '只读用户不能修改批注' });
    }

    const { data, color } = req.body;

    const annotation = await Annotation.findById(req.params.id);
    if (!annotation) {
      return res.status(404).json({ message: '批注不存在' });
    }

    if (data) {
      annotation.data = sanitizeFabricData(annotation.type, data);
    }
    if (color) annotation.color = String(color);
    
    await annotation.save();
    await annotation.populate('createdBy', 'name email');

    res.json({
      message: '更新成功',
      annotation
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.deleteAnnotation = async (req, res) => {
  try {
    if (req.userRole === 'viewer') {
      return res.status(403).json({ message: '只读用户不能删除批注' });
    }

    const annotation = await Annotation.findById(req.params.id);
    if (!annotation) {
      return res.status(404).json({ message: '批注不存在' });
    }

    await Annotation.findByIdAndDelete(req.params.id);

    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};
