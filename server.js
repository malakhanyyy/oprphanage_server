const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- SERVERLESS DATABASE CONNECTION LOGIC ---
let isConnected = false;

const connectDB = async () => {
    if (isConnected) {
        return;
    }
    try {
        const db = await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        isConnected = db.connections[0].readyState;
        console.log('✅ Connected to MongoDB Atlas');
    } catch (err) {
        console.error('❌ Database connection error:', err);
        throw err;
    }
};

// Checkpoint: Ensure database is awake BEFORE running any routes
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (error) {
        return res.status(500).json({ error: "Database connection failed. Check your MONGODB_URI." });
    }
});
// --------------------------------------------------

// 2. DEFINE DATABASE SCHEMA
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: String,
    age: Number,
    avatar: { type: String, default: 'fa-user' },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    stars: { type: Number, default: 0 },
    status: { type: String, default: 'Stable' },
    lastLogin: String,
    history: { type: Array, default: [] },
    chatHistory: { type: Array, default: [] },
    alerts: { type: Array, default: [] }
});
const User = mongoose.model('User', userSchema);

// 3. API ROUTES

// --- SIGN UP / CREATE PROFILE (Admin) ---
app.post('/api/signup', async (req, res) => {
    try {
        const { name, username, age, password, avatar } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: "Username already exists!" });

        const newUser = new User({ name, username, age, password, avatar });
        await newUser.save();
        res.json({ message: "Account created successfully!", user: newUser });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SIGN IN ---
app.post('/api/signin', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username, password });
        if (!user) return res.status(401).json({ error: "Invalid username or password" });

        user.lastLogin = `Today, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        await user.save();
        res.json({ message: "Login successful", user });
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

// --- GET ALL USERS (Admin Dashboard) ---
app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await User.find({});
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- UPDATE USER DATA ---
app.post('/api/user/update', async (req, res) => {
    const { username, updateData } = req.body;
    try {
        const updatedUser = await User.findOneAndUpdate(
            { username: username },
            { $set: updateData },
            { returnDocument: 'after' }
        );
        res.json({ user: updatedUser });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SECURE GROQ AI EVALUATION ---
app.post('/api/ai/analyze', async (req, res) => {
    const { msg } = req.body;
    const systemPrompt = `You are a clinical safety AI. Analyze the user's input.
Determine if it contains passive/active suicidal ideation, depression, hopelessness, self-harm, abuse, or danger. Return JSON with "overall_status" ("SAFE" or "FLAGGED") and a "flagged_summary" explaining why. Format MUST be valid JSON.`;

    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: msg }
                ],
                temperature: 0.1
            })
        });

        const data = await response.json();
        let outputText = data.choices[0].message.content;

        const jsonMatch = outputText.match(/\{[\s\S]*\}/);
        if (jsonMatch) outputText = jsonMatch[0];

        const parsed = JSON.parse(outputText);
        res.json({ status: parsed.overall_status || "SAFE", reason: parsed.flagged_summary || "" });
    } catch (error) {
        res.status(500).json({ status: "AI_ERROR", reason: error.message });
    }
});

// --- SECURE GROQ CHAT BOT ---
app.post('/api/ai/chat', async (req, res) => {
    const { history } = req.body;
    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
            },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: history,
                temperature: 0.7
            })
        });
        const data = await response.json();
        res.json({ reply: data.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// VERCEL REQUIREMENT: Export the app instead of binding to a port
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`🚀 Local Server running on http://localhost:${PORT}`));
}
module.exports = app;
