import dotenv from 'dotenv';
import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import { createObjectCsvWriter } from 'csv-writer';
import multer from 'multer';
import * as fal from "@fal-ai/serverless-client";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

console.log("Starting server initialization...");

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'secure-choice-lending-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' },
}));

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

console.log("Middleware set up complete");

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize FAL AI client
fal.config({
  credentials: process.env.FAL_API_KEY,
});

console.log("OpenAI and FAL AI clients initialized");

// File paths
const usersFilePath = path.join(__dirname, 'users.json');
const interactionsFilePath = path.join(__dirname, 'interactions.json');
const faqsFilePath = path.join(__dirname, 'faqs.json');

console.log("File paths configured");

// Utility functions
async function readJsonFile(filePath) {
  console.log(`Reading JSON file: ${filePath}`);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return data.trim() ? JSON.parse(data) : (filePath.includes('users') ? {} : []);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`File not found: ${filePath}. Returning empty ${filePath.includes('users') ? 'object' : 'array'}.`);
      return filePath.includes('users') ? {} : [];
    }
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  console.log(`Writing JSON file: ${filePath}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  console.log(`File written successfully: ${filePath}`);
}

async function logInteraction(userId, userMessage, aiReply) {
  console.log(`Logging interaction for user: ${userId}`);
  const interactions = await readJsonFile(interactionsFilePath);
  interactions.push({ timestamp: new Date().toISOString(), userId, userMessage, aiReply });
  await writeJsonFile(interactionsFilePath, interactions);
  console.log("Interaction logged successfully");
}

// Admin authentication middleware
function authenticateAdmin(req, res, next) {
  console.log("Authenticating admin...");
  const adminPassword = process.env.ADMIN_PASSWORD || 'secure-choice-admin';
  if (req.session.isAdmin) {
    console.log("Admin already authenticated");
    next();
  } else if (req.body.password === adminPassword) {
    console.log("Admin password correct, setting session");
    req.session.isAdmin = true;
    next();
  } else {
    console.log("Admin authentication failed");
    res.status(401).send('Unauthorized');
  }
}

console.log("Utility functions and admin authentication middleware defined");

// Routes
app.get('/', (req, res) => {
  console.log("Serving index.html");
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Registration endpoint
app.post('/api/register', async (req, res) => {
  console.log("Received registration request");
  const { firstName, phone, email } = req.body;
  const userId = Date.now().toString();

  try {
    const users = await readJsonFile(usersFilePath);
    users[userId] = { firstName, phone, email, conversationHistory: [] };
    await writeJsonFile(usersFilePath, users);
    console.log(`User registered successfully. User ID: ${userId}`);
    res.json({ userId, firstName });
  } catch (error) {
    console.error('Error saving user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  console.log("Received chat request");
  const { userId, message } = req.body;

  try {
    const users = await readJsonFile(usersFilePath);
    const user = users[userId];

    if (!user) {
      console.log(`User not found: ${userId}`);
      return res.status(404).json({ error: 'User not found' });
    }

    user.conversationHistory.push({ role: 'user', content: message });

    // Load FAQs
    const faqs = await readJsonFile(faqsFilePath);

    // Check if the message matches any FAQs
    const faqMatch = faqs.find(faq => message.toLowerCase().includes(faq.question.toLowerCase()));
    if (faqMatch) {
      console.log("FAQ match found");
      const aiReply = faqMatch.answer;
      user.conversationHistory.push({ role: 'assistant', content: aiReply });
      await writeJsonFile(usersFilePath, users);
      await logInteraction(userId, message, aiReply);
      return res.json({ reply: aiReply });
    }

    console.log("No FAQ match, querying OpenAI");
    // Prepare messages for OpenAI
    const messages = [
      { role: "system", content: `You are a knowledgeable mortgage assistant for Secure Choice Lending, providing expert information about mortgages and home loans. Your name is Secure Choice Lending Assistant. Communicate in a professional, friendly manner. Format your responses using Markdown for a clean, modern aesthetic:
      - Use ## for main headers and ### for subheaders
      - Use **bold** for emphasis on key points
      - Use bullet points or numbered lists for multiple items
      - Use > for important quotes or callouts
      - Keep paragraphs short and concise
      - Use \`code blocks\` for numerical examples or rates
    The user's name is ${user.firstName}. Personalize your responses based on previous interactions.` },
      ...user.conversationHistory.slice(-15)  // Limit to last 15 messages
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: messages,
      max_tokens: 1000
    });

    const aiReply = completion.choices[0].message.content.trim();
    console.log("Received reply from OpenAI");

    user.conversationHistory.push({ role: 'assistant', content: aiReply });
    await writeJsonFile(usersFilePath, users);
    await logInteraction(userId, message, aiReply);

    res.json({ reply: aiReply });
  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ error: 'An error occurred while processing your request' });
  }
});

// FAQs endpoint
app.get('/api/faqs', async (req, res) => {
  console.log("Received FAQs request");
  try {
    const faqs = await readJsonFile(faqsFilePath);
    res.json(faqs);
  } catch (error) {
    console.error('Error fetching FAQs:', error);
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

// Set up multer for handling file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Transcription endpoint
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  console.log("Received transcription request");
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  try {
    console.log("FAL API Key:", process.env.FAL_API_KEY ? "Set" : "Not set");
    console.log("Audio file received:", req.file ? "Yes" : "No");

    // Upload the audio file to FAL storage
    const audioFile = new File([req.file.buffer], req.file.originalname, { type: req.file.mimetype });
    const audioUrl = await fal.storage.upload(audioFile);

    // Submit the transcription job
    const { request_id } = await fal.queue.submit("fal-ai/wizper", {
      input: {
        audio_url: audioUrl,
        task: "transcribe",
        language: "en",
        chunk_level: "segment",
        version: "3"
      }
    });

    // Poll for the result
    let result;
    let attempts = 0;
    const maxAttempts = 10;
    const delay = 2000; // 2 seconds

    while (attempts < maxAttempts) {
      try {
        result = await fal.queue.result("fal-ai/wizper", {
          requestId: request_id
        });
        break; // Exit the loop if successful
      } catch (error) {
        if (error.status === 400 && error.body.detail === 'Request is still in progress') {
          console.log(`Attempt ${attempts + 1}: Transcription still in progress. Waiting...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          attempts++;
        } else {
          throw error; // Rethrow if it's a different error
        }
      }
    }

    if (!result) {
      throw new Error('Transcription timed out');
    }

    if (result && result.chunks && result.chunks.length > 0) {
      const transcribedText = result.chunks.map(chunk => chunk.text).join(' ');
      res.json({ text: transcribedText });
    } else {
      res.status(500).json({ error: 'Failed to transcribe audio' });
    }
  } catch (error) {
    console.error('Error in transcription:', error);
    if (error.message === 'Transcription timed out') {
      res.status(504).json({ error: 'Transcription request timed out. Please try again.' });
    } else if (error.status === 401) {
      res.status(500).json({ error: 'Authentication failed with transcription service. Please contact support.' });
    } else {
      res.status(500).json({ error: 'An error occurred during transcription. Please try again later.' });
    }
  }
});

// Admin routes
app.get('/admin', (req, res) => {
  console.log("Serving admin.html");
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/admin/login', authenticateAdmin, (req, res) => {
  console.log("Admin login successful");
  res.json({ success: true });
});

app.get('/admin/dashboard', authenticateAdmin, async (req, res) => {
  console.log("Fetching admin dashboard data");
  try {
    const users = await readJsonFile(usersFilePath);
    res.json(Object.values(users));
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/admin/export-csv', authenticateAdmin, async (req, res) => {
  console.log("Exporting users to CSV");
  try {
    const users = await readJsonFile(usersFilePath);
    const csvWriter = createObjectCsvWriter({
      path: 'users_export.csv',
      header: [
        { id: 'firstName', title: 'First Name' },
        { id: 'phone', title: 'Phone' },
        { id: 'email', title: 'Email' }
      ]
    });

    await csvWriter.writeRecords(Object.values(users));
    res.download('users_export.csv', 'users_export.csv', (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        res.status(500).send('Error downloading file');
      }
      // Delete the file after download
      fs.unlink('users_export.csv', (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting CSV file:', unlinkErr);
      });
    });
  } catch (error) {
    console.error('Error exporting users:', error);
    res.status(500).json({ error: 'Failed to export users' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`OPENAI_API_KEY is ${process.env.OPENAI_API_KEY ? 'set' : 'not set'}`);
  console.log(`FAL_API_KEY is ${process.env.FAL_API_KEY ? 'set' : 'not set'}`);
});

console.log("Server initialization complete");