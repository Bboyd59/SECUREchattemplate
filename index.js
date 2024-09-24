const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
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

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
  console.log(`OPENAI_API_KEY is ${process.env.OPENAI_API_KEY ? 'set' : 'not set'}`);
});