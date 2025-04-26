const express = require('express')
const mongoose = require('mongoose')
const cors = require('cors')
const dotenv = require('dotenv')
const bodyParser = require('body-parser');
const authRoutes = require('./routes/auth')
const assignmentRoutes = require("./routes/assignments")
const submissionRoutes = require("./routes/submissions");
const aiRoutes = require("./routes/aiRoutes"); 
const courseRoutes = require("./routes/courses");
const cloudinary = require('cloudinary').v2;
const morgan = require('morgan');

dotenv.config()


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // Optional: ensure https URLs
});



const app = express()
app.use(morgan('dev'))
app.use(cors())
app.use(express.json())
app.use(bodyParser.json());

const path = require('path'); // Need path module
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes)
app.use("/api/assignment", assignmentRoutes)
app.use("/api/submissions", submissionRoutes); 
app.use("/api/courses", courseRoutes);
app.use("/api/ai", aiRoutes); 

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("MongoDB connected")
    app.listen(5000, () => console.log("Server running on port 5000"))
  })
  .catch(err => console.error("MongoDB connection error:", err))
