// backend/models/Course.js
const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Course title is required.'], // Make title mandatory
    trim: true, 
  },
  courseCode: {
    type: String,
    required: [true, 'Course code is required.'], // Make code mandatory
    trim: true,
    // unique: true, // Optional: Uncomment if course codes must be globally unique
                      // Consider unique per instructor instead if needed:
                      // index: { unique: true, partialFilterExpression: { instructor: { $exists: true } } }
  },
  department: {
    type: String,
    trim: true,
    default: null, // Optional field
  },
  semester: {
    type: String,
    trim: true,
    default: null, // Optional field
  },
  description: {
    type: String,
    trim: true,
    default: null, // Optional field
  },
  instructor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Links to the User collection
    required: [true, 'Instructor is required.'], // Course must have an instructor
    index: true, // Index for faster querying by instructor
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Links to the User collection
  }],
  syllabus: {
    type: mongoose.Schema.Types.Mixed, // Allows storing any JSON-like structure
    default: null, // Default to null, indicating no syllabus initially
  },
  // Optional: Add schedule information if needed
  // schedule: {
  //   days: { type: String, trim: true }, // e.g., "MWF", "TR"
  //   time: { type: String, trim: true }  // e.g., "9:00-10:15"
  // }

}, {
  timestamps: true,
  minimize: false // Keep default behavior unless space is critical
});

// Optional: Add an index for instructor and courseCode if you need uniqueness per instructor
// courseSchema.index({ instructor: 1, courseCode: 1 }, { unique: true });

module.exports = mongoose.model('Course', courseSchema);
