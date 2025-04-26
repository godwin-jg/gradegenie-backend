const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  type: {
    type: String,
    required: [true, 'Assignment type is required.'],
    enum: [
      "essay", "research_paper", "multiple_choice", "short_answer",
      "presentation", "group_project", "discussion", "lab_report",
      "portfolio", "case_study"
    ]
  },
  title: {
    type: String,
    required: [true, 'Assignment title is required.'],
    trim: true,
  },
  course: {
    type: String,
    required: [true, 'Course is required.'],
    trim: true,
  },
  dueDate: {
    type: Date,
    default: null,
  },
  description: {
    type: String,
    required: [true, 'Description is required.'],
  },
  learningObjectives: {
    type: String,
    default: null,
  },
  content: {
    type: mongoose.Schema.Types.Mixed, 
    default: {},
  },
  lmsIntegration: {
    type: [String],
    default: [],
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  totalPoints: {
    type: Number,
    default: 100, // Default to 100 or null/undefined as needed
    min: [0, 'Total points cannot be negative']
  },
  // submissions: [] // Do NOT store submissions directly here
}, { timestamps: true });



module.exports = mongoose.model('Assignment', assignmentSchema);