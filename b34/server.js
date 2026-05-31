const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/potree', express.static('potree'));
app.use('/outputs', express.static('outputs'));
app.use('/models', express.static('models'));

const outputsDir = path.join(__dirname, 'outputs');
if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
}

const modelsDir = path.join(__dirname, 'models');
if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, modelsDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        const timestamp = Date.now();
        cb(null, `${name}_${timestamp}${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.ply', '.pcd', '.xyz', '.xyzrgb', '.pts'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('不支持的文件格式。支持: .ply, .pcd, .xyz, .xyzrgb, .pts'));
        }
    }
});

app.get('/api/files', (req, res) => {
    const files = [];
    
    const readDir = (dir, type) => {
        if (fs.existsSync(dir)) {
            const items = fs.readdirSync(dir);
            items.forEach(item => {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);
                if (stats.isFile()) {
                    files.push({
                        name: item,
                        path: `/${type}/${item}`,
                        size: stats.size,
                        type: type,
                        createdAt: stats.birthtime
                    });
                }
            });
        }
    };
    
    readDir(modelsDir, 'models');
    readDir(outputsDir, 'outputs');
    
    res.json(files);
});

app.post('/api/simplify', (req, res) => {
    const { inputPath, targetPoints } = req.body;
    
    if (!inputPath || !targetPoints) {
        return res.status(400).json({ error: '缺少必要参数: inputPath 和 targetPoints' });
    }
    
    const inputFile = path.join(__dirname, inputPath);
    
    if (!fs.existsSync(inputFile)) {
        return res.status(404).json({ error: '输入文件不存在' });
    }
    
    const ext = path.extname(inputFile);
    const baseName = path.basename(inputFile, ext);
    const outputName = `${baseName}_simplified_${targetPoints}${ext}`;
    const outputFile = path.join(outputsDir, outputName);
    
    const pythonScript = path.join(__dirname, 'cli', 'cloud_simplify.py');
    const command = `python "${pythonScript}" "${inputFile}" -o "${outputFile}" -n ${targetPoints}`;
    
    console.log(`执行命令: ${command}`);
    
    exec(command, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        if (error) {
            console.error(`执行错误: ${error}`);
            console.error(`stderr: ${stderr}`);
            return res.status(500).json({ 
                error: '处理失败', 
                details: error.message,
                stderr: stderr 
            });
        }
        
        console.log(`stdout: ${stdout}`);
        
        const stats = fs.existsSync(outputFile) ? fs.statSync(outputFile) : null;
        
        res.json({
            success: true,
            outputPath: `/outputs/${outputName}`,
            outputName: outputName,
            size: stats ? stats.size : 0,
            log: stdout
        });
    });
});

app.post('/api/upload', upload.single('pointcloud'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '没有上传文件' });
    }
    
    res.json({
        success: true,
        name: req.file.filename,
        path: `/models/${req.file.filename}`,
        size: req.file.size
    });
});

app.get('/api/convert-potree', (req, res) => {
    res.json({ 
        message: '此功能需要安装 PotreeConverter。可以使用 Potree 直接加载 .ply 文件。',
        supported: false 
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`点云可视化服务器运行在: http://localhost:${PORT}`);
    console.log(`可用点云文件目录: outputs/ 和 models/`);
});

