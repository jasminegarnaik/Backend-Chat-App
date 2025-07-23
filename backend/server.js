
// This covers: Express setup, REST APIs, WebSockets, middleware, error handling

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// BACKEND CONCEPT 1: MIDDLEWARE
// Middleware functions run before your route handlers
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Parse JSON request bodies
app.use(express.static('public')); // Serve static files

// BACKEND CONCEPT 2: IN-MEMORY DATA STORAGE
// In production, you'd use a database like MongoDB or PostgreSQL
let messages = []; // Array to store chat messages
let users = new Map(); // Map to store connected users
let rooms = new Map(); // Map to store chat rooms

// BACKEND CONCEPT 3: REST API ENDPOINTS
// GET endpoint to retrieve all messages
app.get('/api/messages', (req, res) => {
  try {
    res.json({
      success: true,
      messages: messages,
      count: messages.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch messages'
    });
  }
});

// GET endpoint to retrieve messages from a specific room
app.get('/api/messages/:room', (req, res) => {
  try {
    const room = req.params.room;
    const roomMessages = messages.filter(msg => msg.room === room);
    
    res.json({
      success: true,
      room: room,
      messages: roomMessages,
      count: roomMessages.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch room messages'
    });
  }
});

// POST endpoint to send a new message
app.post('/api/messages', (req, res) => {
  try {
    const { username, message, room = 'general' } = req.body;
    
    // BACKEND CONCEPT 4: INPUT VALIDATION
    if (!username || !message) {
      return res.status(400).json({
        success: false,
        error: 'Username and message are required'
      });
    }
    
    if (message.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'Message too long (max 500 characters)'
      });
    }
    
    // Create new message object
    const newMessage = {
      id: Date.now().toString(),
      username: username.trim(),
      message: message.trim(),
      room: room.trim(),
      timestamp: new Date().toISOString()
    };
    
    // Add to messages array
    messages.push(newMessage);
    
    // Keep only last 100 messages to prevent memory issues
    if (messages.length > 100) {
      messages = messages.slice(-100);
    }
    
    // Emit to all connected clients in the room
    io.to(room).emit('new_message', newMessage);
    
    res.status(201).json({
      success: true,
      message: newMessage
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
});

// GET endpoint to retrieve active users
app.get('/api/users', (req, res) => {
  try {
    const activeUsers = Array.from(users.values());
    res.json({
      success: true,
      users: activeUsers,
      count: activeUsers.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

// GET endpoint to retrieve available rooms
app.get('/api/rooms', (req, res) => {
  try {
    const activeRooms = Array.from(rooms.keys());
    res.json({
      success: true,
      rooms: activeRooms,
      count: activeRooms.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch rooms'
    });
  }
});

// BACKEND CONCEPT 5: WEBSOCKETS FOR REAL-TIME COMMUNICATION
// WebSockets allow bidirectional, real-time communication
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Handle user joining
  socket.on('join_user', (userData) => {
    try {
      const { username, room = 'general' } = userData;
      
      // Store user information
      users.set(socket.id, {
        id: socket.id,
        username: username,
        room: room,
        joinedAt: new Date().toISOString()
      });
      
      // Join the specified room
      socket.join(room);
      
      // Add room to rooms map
      if (!rooms.has(room)) {
        rooms.set(room, new Set());
      }
      rooms.get(room).add(socket.id);
      
      // Notify others in the room
      socket.to(room).emit('user_joined', {
        username: username,
        message: `${username} joined the chat`,
        timestamp: new Date().toISOString()
      });
      
      // Send current users list to the new user
      const roomUsers = Array.from(users.values()).filter(u => u.room === room);
      socket.emit('users_list', roomUsers);
      
      console.log(`${username} joined room: ${room}`);
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to join chat' });
    }
  });
  
  // Handle real-time message sending
  socket.on('send_message', (messageData) => {
    try {
      const user = users.get(socket.id);
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }
      
      const { message } = messageData;
      const room = user.room;
      
      // Validation
      if (!message || message.trim().length === 0) {
        socket.emit('error', { message: 'Message cannot be empty' });
        return;
      }
      
      // Create message object
      const newMessage = {
        id: Date.now().toString(),
        username: user.username,
        message: message.trim(),
        room: room,
        timestamp: new Date().toISOString()
      };
      
      // Store message
      messages.push(newMessage);
      
      // Broadcast to all users in the room
      io.to(room).emit('new_message', newMessage);
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to send message' });
    }
  });
  
  // Handle user typing indicator
  socket.on('typing_start', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(user.room).emit('user_typing', {
        username: user.username,
        isTyping: true
      });
    }
  });
  
  socket.on('typing_stop', () => {
    const user = users.get(socket.id);
    if (user) {
      socket.to(user.room).emit('user_typing', {
        username: user.username,
        isTyping: false
      });
    }
  });
  
  // Handle user disconnection
  socket.on('disconnect', () => {
    try {
      const user = users.get(socket.id);
      if (user) {
        // Remove from room
        if (rooms.has(user.room)) {
          rooms.get(user.room).delete(socket.id);
          if (rooms.get(user.room).size === 0) {
            rooms.delete(user.room);
          }
        }
        
        // Notify others in the room
        socket.to(user.room).emit('user_left', {
          username: user.username,
          message: `${user.username} left the chat`,
          timestamp: new Date().toISOString()
        });
        
        // Remove user from users map
        users.delete(socket.id);
        
        console.log(`${user.username} disconnected`);
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// BACKEND CONCEPT 6: ERROR HANDLING MIDDLEWARE
// This runs after all routes and handles any errors
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Something went wrong!'
  });
});

// BACKEND CONCEPT 7: 404 HANDLER
// This runs when no route matches the request
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// BACKEND CONCEPT 8: SERVER STARTUP
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Chat server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready for connections`);
  console.log(`🌐 API endpoints available at http://localhost:${PORT}/api`);
});

// BACKEND CONCEPT 9: GRACEFUL SHUTDOWN
// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

/* 

KEY LEARNING CONCEPTS COVERED:
- Express.js setup and middleware
- RESTful API design (GET, POST endpoints)
- WebSocket real-time communication
- Input validation and error handling
- In-memory data storage
- CORS configuration
- Graceful shutdown handling
- Request/Response cycle
- Socket.io for real-time features

NEXT STEPS TO EXPLORE:
- Add user authentication (JWT tokens)
- Integrate a database (MongoDB/PostgreSQL)
- Add message persistence
- Implement rate limiting
- Add file upload functionality

*/