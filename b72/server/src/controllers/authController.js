const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

exports.register = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: '邮箱已被注册' });
    }

    const user = new User({ email, password, name });
    await user.save();

    const token = generateToken(user._id);
    const userData = user.toObject();
    delete userData.password;

    res.status(201).json({
      message: '注册成功',
      token,
      user: userData
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    const token = generateToken(user._id);
    const userData = user.toObject();
    delete userData.password;

    res.json({
      message: '登录成功',
      token,
      user: userData
    });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const userData = req.user.toObject();
    delete userData.password;
    res.json({ user: userData });
  } catch (error) {
    res.status(500).json({ message: '服务器错误', error: error.message });
  }
};
