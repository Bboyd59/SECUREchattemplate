// index.js

const express = require('express');
const bodyParser = require('body-parser');
const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' },
}));

app.use(express.static('.'));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// File paths
const usersFilePath = path.join(__dirname, 'users.json');
const interactionsFilePath = path.join(__dirname, 'interactions.json');
const faqsFilePath = path.join(__dirname, 'faqs.json');

// Utility functions
async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return data.trim() ? JSON.parse(data) : (filePath.includes('users') ? {} : []);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return filePath.includes('users') ? {} : [];
    }
    throw error;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function logInteraction(userId, userMessage, aiReply) {
  const interactions = await readJsonFile(interactionsFilePath);
  interactions.push({ timestamp: new Date().toISOString(), userId, userMessage, aiReply });
  await writeJsonFile(interactionsFilePath, interactions);
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Registration endpoint
app.post('/api/register', async (req, res) => {
  const { firstName, phone, email } = req.body;
  const userId = Date.now().toString();

  try {
    const users = await readJsonFile(usersFilePath);
    users[userId] = { firstName, phone, email, conversationHistory: [] };
    await writeJsonFile(usersFilePath, users);
    res.json({ userId, firstName });
  } catch (error) {
    console.error('Error saving user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  const { userId, message } = req.body;

  try {
    const users = await readJsonFile(usersFilePath);
    const user = users[userId];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.conversationHistory.push({ role: 'user', content: message });

    // Load FAQs
    const faqs = await readJsonFile(faqsFilePath);

    // Check if the message matches any FAQs
    const faqMatch = faqs.find(faq => message.toLowerCase().includes(faq.question.toLowerCase()));
    if (faqMatch) {
      const aiReply = faqMatch.answer;
      user.conversationHistory.push({ role: 'assistant', content: aiReply });
      await writeJsonFile(usersFilePath, users);
      await logInteraction(userId, message, aiReply);
      return res.json({ reply: aiReply });
    }

    // Construct the prompt with conversation history
    let prompt = `You are a knowledgeable mortgage assistant for Secure Mortgage, providing expert information about mortgages, home loans, and related financial services. Be professional, friendly, and format your responses in Markdown. The user's name is ${user.firstName}. Use previous interactions to personalize your responses. Prioritize security, confidentiality, and accuracy in all discussions.\n\n`;

    // Limit conversation history to last 15 messages
    const conversationHistory = user.conversationHistory.slice(-15);

    for (const msg of conversationHistory) {
      if (msg.role === 'user') {
        prompt += `Human: ${msg.content}\n`;
      } else {
        prompt += `Assistant: ${msg.content}\n`;
      }
    }

    prompt += `Assistant:`;

    const completion = await anthropic.completions.create({
      model: 'claude-v1',
      prompt: prompt,
      max_tokens_to_sample: 1000,
      stop_sequences: ['Human:', 'Assistant:'],
    });

    const aiReply = completion.completion.trim();

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
  try {
    const faqs = await readJsonFile(faqsFilePath);
    res.json(faqs);
  } catch (error) {
    console.error('Error fetching FAQs:', error);
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`ANTHROPIC_API_KEY is ${process.env.ANTHROPIC_API_KEY ? 'set' : 'not set'}`);
});
