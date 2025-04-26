const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'uploads'); 
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // Save files to the 'uploads' directory
  },
  filename: function (req, file, cb) {
    // Create a unique filename: fieldname-timestamp.extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Example: Accept common document/image types
  const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|md/;
  const mimetype = allowedTypes.test(file.mimetype);
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('File upload only supports the following filetypes - ' + allowedTypes));
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Example: Limit file size to 10MB
    // fileFilter: fileFilter // Uncomment to enable file filtering
});

const uploadSingle = upload.single('submissionFile');

module.exports = { uploadSingle, uploadDir }; 