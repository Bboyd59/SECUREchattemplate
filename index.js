const express = require('express');
const bodyParser = require('body-parser');
const { Anthropic } = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

app.use(express.static('.'));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const usersFilePath = path.join(__dirname, 'users.json');
const interactionsFilePath = path.join(__dirname, 'interactions.json');
const faqsFilePath = path.join(__dirname, 'faqs.json');

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

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  if (req.session.loggedIn) {
    res.sendFile(path.join(__dirname, 'admin.html'));
  } else {
    res.sendFile(path.join(__dirname, 'login.html'));
  }
});

app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    res.redirect('/admin');
  } else {
    res.status(401).send('Invalid password');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.loggedIn = false;
  res.redirect('/admin');
});

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

app.post('/api/chat', async (req, res) => {
  const { userId, message } = req.body;

  try {
    const users = await readJsonFile(usersFilePath);
    const user = users[userId];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.conversationHistory.push({ role: 'user', content: message });

    const messages = user.conversationHistory.map(msg => ({
      role: msg.role === 'human' ? 'user' : msg.role,
      content: msg.content
    }));

    const completion = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 1000,
      messages: messages,
      system: `You are a helpful assistant for Secure Mortgage, providing information about mortgages and home loans. Be concise, friendly, and format your responses in Markdown. The user's name is ${user.firstName}. Use previous interactions to personalize your responses. Prioritize security and confidentiality in all discussions.`
    });

    const aiReply = completion.content[0].text;

    user.conversationHistory.push({ role: 'assistant', content: aiReply });
    await writeJsonFile(usersFilePath, users);
    await logInteraction(userId, message, aiReply);

    res.json({ reply: aiReply });
  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ error: 'An error occurred while processing your request' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await readJsonFile(usersFilePath);
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.get('/api/chats', async (req, res) => {
  try {
    const users = await readJsonFile(usersFilePath);
    const chats = {};
    for (const [userId, user] of Object.entries(users)) {
      if (user.conversationHistory && user.conversationHistory.length > 0) {
        chats[userId] = [
          { firstName: user.firstName },
          ...user.conversationHistory
        ];
      }
    }
    res.json(chats);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.get('/api/faqs', async (req, res) => {
  try {
    const faqs = await readJsonFile(faqsFilePath);
    res.json(faqs);
  } catch (error) {
    console.error('Error fetching FAQs:', error);
    res.status(500).json({ error: 'Failed to fetch FAQs' });
  }
});

app.post('/api/faqs', async (req, res) => {
  try {
    const { question, answer } = req.body;
    const faqs = await readJsonFile(faqsFilePath);
    const newFaq = {
      id: Date.now(),
      question,
      answer,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    faqs.push(newFaq);
    await writeJsonFile(faqsFilePath, faqs);
    res.json(newFaq);
  } catch (error) {
    console.error('Error adding FAQ:', error);
    res.status(500).json({ error: 'Failed to add FAQ' });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    const users = await readJsonFile(usersFilePath);

    let csvContent = "Full Name,Email,Phone Number\n";
    for (const user of Object.values(users)) {
      csvContent += `${user.firstName},${user.email},${user.phone}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=secure_mortgage_users.csv');
    res.send(csvContent);
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`ANTHROPIC_API_KEY is ${process.env.ANTHROPIC_API_KEY ? 'set' : 'not set'}`);
});