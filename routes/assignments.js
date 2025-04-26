const express = require('express');
const mongoose = require('mongoose')
const Assignment = require('../models/Assignment'); 
const Submission = require('../models/Submission');
const { generateContent } = require("../utils/openai")
const authMiddleware = require('../middleware/authMiddleware'); 

const router = express.Router();

router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      type,
      title,
      course,
      dueDate,
      description,
      learningObjectives,
      content,
      lmsIntegration
    } = req.body;

    const createdBy = req.user.id;

    if (!type || !title || !course || !description) {
      return res.status(400).json({ message: 'Missing required fields: type, title, course, description' });
    }

    const newAssignment = new Assignment({
      type,
      title,
      course,
      dueDate: dueDate || null, // Handle potentially empty date
      description,
      learningObjectives: learningObjectives || null,
      content: content || {}, // Ensure content is at least an empty object
      lmsIntegration: lmsIntegration || [],
      createdBy, // Link to the user who created it
    });

    const savedAssignment = await newAssignment.save();

    res.status(201).json(savedAssignment); // 201 Created status

  } catch (error) {
    console.error("Error creating assignment:", error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ message: 'Validation failed', errors: messages });
    }
    res.status(500).json({ message: 'Server error creating assignment', error: error.message });
  }
});


router.get('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const assignments = await Assignment.find({ createdBy: userId }).sort({ createdAt: -1 });
        res.status(200).json(assignments);
    } catch (error) {
        console.error("Error fetching assignments:", error);
        res.status(500).json({ message: 'Server error fetching assignments', error: error.message });
    }
});

router.get('/edit/:id', authMiddleware, async (req, res) => {
  try {
      console.log("Received request to fetch assignment for editing with ID:", req.params.id);
      const userId = req.user.id;
      const assignmentId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
          return res.status(400).json({ message: 'Invalid assignment ID format' });
      }

      const assignment = await Assignment.findOne({ _id: assignmentId, createdBy: userId });

      if (!assignment) {
          const assignmentExists = await Assignment.findById(assignmentId).select('_id');
          if (!assignmentExists) {
              return res.status(404).json({ message: 'Assignment not found.' });
          } else {
              return res.status(403).json({ message: 'You do not have permission to view this assignment.' });
          }
      }

      res.status(200).json(assignment);

  } catch (error) {
      console.error("Error fetching assignment details:", error);
      res.status(500).json({ message: 'Server error fetching assignment details', error: error.message });
  }
});


router.get('/:id', authMiddleware, async (req, res) => {
  try {
      const userId = req.user.id; 
      const assignmentId = req.params.id;

      if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
           return res.status(400).json({ message: 'Invalid assignment ID format' });
      }

      const assignment = await Assignment.findOne({ _id: assignmentId, createdBy: userId }).lean(); // Use lean() for plain JS object

      if (!assignment) {
          
           const assignmentExists = await Assignment.findById(assignmentId).select('_id');
           if (!assignmentExists) {
              return res.status(404).json({ message: 'Assignment not found.' });
           } else {
              return res.status(403).json({ message: 'You do not have permission to view this assignment.' });
           }
      }

      const submissions = await Submission.find({ assignmentId: assignment._id })
                                          .populate('submittedBy', 'name email') // Select 'name' and 'email' from User model
                                          .sort({ submissionDate: -1 }) // Sort by submission date, newest first
                                          .lean(); // Use lean() for plain JS objects

      const formattedSubmissions = submissions.map(sub => ({
          ...sub,
          studentName: sub.submittedBy?.name || null, // Handle cases where population might fail or name is missing
      }));


      const responsePayload = {
           ...assignment,            
           submissions: formattedSubmissions // Add the fetched & formatted submissions array
       };

      res.status(200).json(responsePayload);

  } catch (error) {
      console.error("Error fetching assignment details:", error);
      res.status(500).json({ message: 'Server error fetching assignment details', error: error.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
    try {
        const { id: assignmentId } = req.params;
        const userId = req.user.id;
        const updates = req.body; 

        if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
            return res.status(400).json({ message: 'Invalid assignment ID format.' });
        }

        const assignment = await Assignment.findById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ message: 'Assignment not found.' });
        }

        if (assignment.createdBy.toString() !== userId.toString()) {
             return res.status(403).json({ message: 'You do not have permission to update this assignment.' });
        }

        const allowedUpdates = [
            'title', 'description', 'dueDate', 'totalPoints', 'type',
            'content', // Allows updating the nested { instructions, rubric } object
            'publishToLMS', 'plagiarismCheckEnabled', 'aiGradingEnabled', 'allowLateSubmissions'
            // Note: 'course' is usually not editable after creation
        ];
        const finalUpdates = {};

        Object.keys(updates).forEach(key => {
            if (allowedUpdates.includes(key)) {
                 // Special handling for nested 'content' object if needed,
                 // but direct assignment often works if the whole object is sent.
                 // Make sure frontend sends the full { instructions, rubric } object if updating content.
                finalUpdates[key] = updates[key];
            }
        });

        // Prevent changing owner or course via this route
        delete finalUpdates.createdBy;
        delete finalUpdates.course; // Usually course cannot be changed

        // Perform the update using findByIdAndUpdate
        const updatedAssignment = await Assignment.findByIdAndUpdate(
            assignmentId,
            { $set: finalUpdates }, // Use $set to update only specified fields
            { new: true, runValidators: true } // Return the updated doc, run schema validators
        );

        if (!updatedAssignment) { // Should not happen if findById worked, but good practice
             return res.status(404).json({ message: 'Assignment not found after update attempt.' });
        }

        res.status(200).json(updatedAssignment); // Send back the updated assignment

    } catch (error) {
        console.error("Error updating assignment:", error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map((val) => val.message);
            return res.status(400).json({ message: 'Validation failed', errors: messages });
        }
        if (error.code === 11000) { // Handle potential unique constraint errors if any
             const field = Object.keys(error.keyPattern)[0];
             return res.status(409).json({ message: `Update failed: An assignment with this ${field} might already exist.` });
        }
        res.status(500).json({ message: 'Server error updating assignment.', error: error.message });
    }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
      console.log("Received request to delete assignment with ID:", req.params.id);
      const { id: assignmentId } = req.params;
      const userId = req.user.id;

      if (!mongoose.Types.ObjectId.isValid(assignmentId)) {
          return res.status(400).json({ message: 'Invalid assignment ID format.' });
      }

      // Find the assignment to check ownership before deleting
      const assignment = await Assignment.findOne({ _id: assignmentId, createdBy: userId });

      if (!assignment) {
          const assignmentExists = await Assignment.findById(assignmentId).select('_id');
          if (!assignmentExists) {
              return res.status(404).json({ message: 'Assignment not found.' });
          } else {
              return res.status(403).json({ message: 'You do not have permission to delete this assignment.' });
          }
      }

      // --- TODO: Handle associated data deletion ---
      // Decide if you should delete associated submissions when an assignment is deleted.
      // await Submission.deleteMany({ assignmentId: assignmentId });
      // console.log(`Deleted submissions for assignment ${assignmentId}`);
      // ---------------------------------------------

      await Assignment.findByIdAndDelete(assignmentId);

      res.status(200).json({ message: 'Assignment deleted successfully.' });

  } catch (error) {
      console.error("Error deleting assignment:", error);
      res.status(500).json({ message: 'Server error deleting assignment.', error: error.message });
  }
});



router.post("/generate", async (req, res) => {
    const { prompt } = req.body;
  
    console.log("Received request with prompt:", prompt);
  
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }
  
    try {
      const content = await generateContent(prompt);
      res.json({ content });
    } catch (err) {
      console.error("OpenAI Error:", err);
      res.status(500).json({ error: "Failed to generate content" });
    }
});
// You would also add routes for PUT (update) and DELETE assignments here
// router.put('/:id', authMiddleware, async (req, res) => { ... });
// router.delete('/:id', authMiddleware, async (req, res) => { ... });


module.exports = router;