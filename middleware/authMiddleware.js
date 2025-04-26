const jwt = require('jsonwebtoken'); 
const User = require('../models/User'); 
const dotenv = require('dotenv');

dotenv.config(); 

const authMiddleware = async (req, res, next) => {
  const { authorization } = req.headers;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization token required' });
  }

  const token = authorization.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET); 
    const user = await User.findById(decoded.id).select('_id'); 
    if (!user) {
        throw new Error('User not found');
    }

    req.user = { id: user._id }; 
    next();

  } catch (error) {
    console.error('Authentication error:', error);
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
     return res.status(401).json({ message: 'Request is not authorized' });
  }
};

module.exports = authMiddleware;