const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const db = require('./database');

// ── Session token helpers ──────────────────────────────────────────────────
// A simple, self-contained signed-token scheme (no external JWT lib needed).
// Token format (base64url): payload.signature
// Payload is JSON: { username, exp }  |  Signature = HMAC-SHA256(payload, secret)
const TOKEN_SECRET = (() => {
    const cfgPath = path.join(__dirname, 'config.json');
    let cfg = {};
    if (fs.existsSync(cfgPath)) { try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) {} }
    if (!cfg.tokenSecret) {
        cfg.tokenSecret = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    }
    return cfg.tokenSecret;
})();

const TOKEN_COOKIE  = 'nl_session';
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function createToken(username) {
    const payload = Buffer.from(JSON.stringify({
        username,
        exp: Math.floor(Date.now() / 1000) + TOKEN_MAX_AGE
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (data.exp < Math.floor(Date.now() / 1000)) return null; // expired
        return data;
    } catch (e) { return null; }
}

function setSessionCookie(res, username) {
    res.cookie(TOKEN_COOKIE, createToken(username), {
        httpOnly: true,
        sameSite: 'Strict',
        maxAge: TOKEN_MAX_AGE * 1000 // ms
    });
}

// Avatar upload storage
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'public', 'avatars');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, req.headers['x-username'] + ext);
    }
});
const upload = multer({ storage: avatarStorage, limits: { fileSize: 2 * 1024 * 1024 } });

const CONFIG_FILE = path.join(__dirname, 'config.json');

// Returns the node's persistent UUID, creating and saving one if absent
function getOrCreateUuid() {
    let cfg = {};
    if (fs.existsSync(CONFIG_FILE)) {
        try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { }
    }
    if (!cfg.uuid) {
        cfg.uuid = crypto.randomUUID();
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
        console.log(`[Node] Generated new UUID: ${cfg.uuid}`);
    }
    return cfg.uuid;
}

// Memory logs container
const serverLogs = [];
function serverLog(msg) {
    const formatted = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log(msg); // Output to stdout/system log
    serverLogs.push(formatted);
    if (serverLogs.length > 50) serverLogs.shift();
}

let config = {};
let isInstalled = (() => {
    if (!fs.existsSync(CONFIG_FILE)) return false;
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return !!(cfg.nodeName); // only "installed" if setup has been completed
    } catch (e) { return false; }
})();

const PORT = process.env.PORT || 3001;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Middleware to serve Setup or Main app
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
    if (!isInstalled) {
        if (req.path === '/api/setup' && req.method === 'POST') {
            return next();
        }
        // Serve setup static files
        express.static(path.join(__dirname, 'setup-public'))(req, res, next);
    } else {
        next();
    }
});

// Setup API endpoint (only available if not installed)
app.post('/api/setup', (req, res) => {
    if (isInstalled) return res.status(400).json({ error: 'Already configured.' });

    const { nodeType, nodeName, adminUser, adminPass } = req.body;

    if (!nodeType || !nodeName || !adminUser || !adminPass) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    config = {
        nodeType: nodeType,
        nodeName: nodeName,
        port: PORT,
        cnodeUrl: process.env.CNODE_URL || 'http://localhost:3000'
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

    // Register admin user
    db.registerUser(adminUser, adminPass, 'Administrator', 'System Admin Account', (err) => {
        if (err && err.message !== 'User already exists') {
            serverLog("Error creating admin user: " + err.message);
            return res.status(500).json({ error: err.message });
        }

        serverLog("Setup complete. Node configuration saved.");
        isInstalled = true; // Switch routing state

        // Initialize main application logic
        initializeChatApp();

        res.json({ status: 'ok' });
    });
});

// Initialize Main Chat application routes and sockets
let cnodeSocket = null;
const localUsers = new Map();       // username → socketId
const activeSessions = new Map();   // username → { socketId, connectedAt }
// In-memory group cache for this node: groupId → group object
const localGroups = new Map();
const startTime = Date.now();

function initializeChatApp() {
    if (!config.nodeName) {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        config.port = process.env.PORT || config.port;
        config.nodeName = process.env.NODE_NAME || config.nodeName;
    }

    const NODE_NAME = config.nodeName;
    const CNODE_URL = config.cnodeUrl;

    // Connect to Federation Node (CNode)
    if (!cnodeSocket) {
        cnodeSocket = ioClient(CNODE_URL);

        const NODE_UUID = getOrCreateUuid();
        serverLog(`Node UUID: ${NODE_UUID}`);

        cnodeSocket.on('connect', () => {
            serverLog(`Connected to Federation Node at ${CNODE_URL}`);
            cnodeSocket.emit('register_node', { nodeId: NODE_NAME, uuid: NODE_UUID });
        });

        cnodeSocket.on('registered', (data) => {
            serverLog(`Successfully registered with CNode as ${data.nodeId}`);
            // Request our groups from the Federation Node
            cnodeSocket.emit('get_my_groups', { nodeName: NODE_NAME });
        });

        cnodeSocket.on('register_error', (data) => {
            serverLog(`[ERROR] Registration failed: ${data.error}`);
            serverLog(`[ERROR] This node's UUID is ${NODE_UUID}. Change nodeName in config.json and restart.`);
        });

        // ── Group events from Federation Node ───────────────────────────────

        // Bulk group list (sent on registration or on-demand)
        cnodeSocket.on('my_groups', (groups) => {
            groups.forEach(g => localGroups.set(g.groupId, g));
            serverLog(`Loaded ${groups.length} group(s) from Federation Node`);
            // Notify any already-logged-in users
            localUsers.forEach((socketId) => {
                io.to(socketId).emit('groups_list', groups);
            });
        });

        // A new group was created (this node has at least one member)
        cnodeSocket.on('group_created', (group) => {
            localGroups.set(group.groupId, group);
            serverLog(`Group created: "${group.name}" (${group.groupId})`);
            // Push to all local users who are members of this group
            group.members
                .filter(m => m.node === NODE_NAME)
                .forEach(m => {
                    const sid = localUsers.get(m.user);
                    if (sid) io.to(sid).emit('group_created', group);
                });
        });

        // Incoming group message — save and deliver to online local members
        cnodeSocket.on('receive_group_message', (data) => {
            const { groupId, fromUser, fromNode, message } = data;
            const group = localGroups.get(groupId);

            db.saveGroupMessage(groupId, fromUser, fromNode, message, (err) => {
                if (err) serverLog('Error saving group message: ' + err.message);
            });

            // Deliver to all online local members of this group
            const localMembers = group
                ? group.members.filter(m => m.node === NODE_NAME)
                : [];

            localMembers.forEach(m => {
                const sid = localUsers.get(m.user);
                if (sid) io.to(sid).emit('group_chat_message', data);
            });
        });

        // ── Direct message events from Federation Node ───────────────────────

        cnodeSocket.on('receive_message', (data) => {
            const { fromUser, fromNode, toUser, toNode, message } = data;

            db.getUserProfile(toUser, (err, profile) => {
                if (err || !profile) {
                    cnodeSocket.emit('route_error_report', {
                        error: `User "${toUser}" was not found on node "${toNode}".`,
                        fromUser,
                        fromNode,
                        toUser,
                        toNode
                    });
                    return;
                }

                db.saveMessage(fromUser, fromNode, toUser, toNode, message, (err) => {
                    if (err) serverLog('Error saving received message: ' + err.message);
                });

                const targetSocketId = localUsers.get(toUser);
                if (targetSocketId) {
                    io.to(targetSocketId).emit('chat_message', data);
                }
            });
        });

        cnodeSocket.on('route_error', (data) => {
            const { error, fromUser, toUser, toNode } = data;
            const targetSocketId = localUsers.get(fromUser);
            if (targetSocketId) {
                io.to(targetSocketId).emit('message_error', { error, toUser, toNode });
            }
        });

        // ── Call signalling: Federation Node → Browser ───────────────────────
        // For each event, find the target local user's socket and forward.

        // An incoming call arrives for a local user
        cnodeSocket.on('incoming_call', (data) => {
            const sid = localUsers.get(data.toUser);
            if (sid) io.to(sid).emit('incoming_call', data);
        });

        // Answer SDP arrives for the caller
        cnodeSocket.on('call_answered', (data) => {
            const sid = localUsers.get(data.toUser);
            if (sid) io.to(sid).emit('call_answered', data);
        });

        // Callee rejected the call
        cnodeSocket.on('call_rejected', (data) => {
            const sid = localUsers.get(data.toUser);
            if (sid) io.to(sid).emit('call_rejected', data);
        });

        // Remote party hung up
        cnodeSocket.on('call_ended', (data) => {
            const sid = localUsers.get(data.toUser);
            if (sid) io.to(sid).emit('call_ended', data);
        });

        // ICE candidate for a local user
        cnodeSocket.on('call_ice', (data) => {
            const sid = localUsers.get(data.toUser);
            if (sid) io.to(sid).emit('call_ice', data);
        });

        // Group call signalling — deliver to the specific local target user
        cnodeSocket.on('group_call_signal', (data) => {
            const sid = localUsers.get(data.toUser);
            if (sid) io.to(sid).emit('group_call_signal', data);
        });

        // Call error (e.g. target node offline)
        cnodeSocket.on('call_error', (data) => {
            // Notify all local users of the error (rare — only if target node offline)
            localUsers.forEach((sid) => io.to(sid).emit('call_error', data));
        });
    }
}

// Register main app static directory and routes (always mounted, but middleware will block access if not installed)
app.use(express.static(path.join(__dirname, 'public')));


app.get('/api/info', (req, res) => {
    res.json({ nodeName: config.nodeName || 'Node' });
});

// Check if a node name is available in the Federation Node's registry
// Used by the setup wizard before committing a name
app.get('/api/check-name', (req, res) => {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'name query param required' });

    const cnodeUrl = process.env.CNODE_URL || 'http://localhost:3000';
    const httpLib = require('http');
    try {
        const url = new URL(cnodeUrl);
        const request = httpLib.get({
            hostname: url.hostname,
            port: url.port,
            path: '/api/registry'
        }, (response) => {
            let data = '';
            response.on('data', (chunk) => data += chunk);
            response.on('end', () => {
                try {
                    const registry = JSON.parse(data);
                    const taken = Object.prototype.hasOwnProperty.call(registry, name);
                    res.json({ available: !taken });
                } catch (e) {
                    // Can't reach registry — allow optimistically, server will enforce
                    res.json({ available: true, warning: 'Could not reach Federation Node registry.' });
                }
            });
        });
        request.on('error', () => {
            res.json({ available: true, warning: 'Federation Node is offline; name will be validated on connect.' });
        });
    } catch (e) {
        res.json({ available: true, warning: 'Invalid Federation Node URL in config.' });
    }
});

app.get('/api/peers', (req, res) => {
    const httpLib = require('http');
    try {
        const url = new URL(config.cnodeUrl);
        const request = httpLib.get({
            hostname: url.hostname,
            port: url.port,
            path: '/api/status'
        }, (response) => {
            let data = '';
            response.on('data', (chunk) => data += chunk);
            response.on('end', () => {
                try {
                    res.json(JSON.parse(data));
                } catch (e) {
                    res.json({ nodes: [] });
                }
            });
        });
        request.on('error', (err) => {
            res.json({ nodes: [] });
        });
    } catch (e) {
        res.json({ nodes: [] });
    }
});

// ── Session endpoints ──────────────────────────────────────────────────────

// Verify existing session cookie — used by the client on page load
app.get('/api/me', (req, res) => {
    const data = verifyToken(req.cookies[TOKEN_COOKIE]);
    if (!data) return res.status(401).json({ error: 'Not authenticated' });
    // Also confirm the user still exists and isn't banned
    db.getUserProfile(data.username, (err, profile) => {
        if (err || !profile) return res.status(401).json({ error: 'User not found' });
        if (profile.banned === 1) {
            res.clearCookie(TOKEN_COOKIE);
            return res.status(403).json({ error: 'Your account has been banned.' });
        }
        res.json({ status: 'ok', username: data.username, nodeName: config.nodeName });
    });
});

// Logout — clear the session cookie
app.post('/api/logout', (req, res) => {
    res.clearCookie(TOKEN_COOKIE);
    res.json({ status: 'ok' });
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    db.verifyUser(username, password, (err, isValid) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!isValid) return res.status(401).json({ error: 'Invalid username or password' });
        // Check if banned
        db.getUserProfile(username, (err2, profile) => {
            if (!err2 && profile && profile.banned === 1) {
                return res.status(403).json({ error: 'Your account has been banned from this node.' });
            }
            setSessionCookie(res, username);
            res.json({ status: 'ok', username, nodeName: config.nodeName });
        });
    });
});

// Signup
app.post('/api/signup', (req, res) => {
    const { username, password, displayName, bio } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    db.registerUser(username, password, displayName, bio, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        setSessionCookie(res, username);
        res.json({ status: 'ok', username, nodeName: config.nodeName });
    });
});

app.get('/api/messages', (req, res) => {
    const { user, targetUser, targetNode } = req.query;
    if (!user || !targetUser || !targetNode) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    db.getMessages(user, config.nodeName, targetUser, targetNode, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get groups for the logged-in user (checks which groups include this node)
app.get('/api/groups', (req, res) => {
    const { user } = req.query;
    if (!user) return res.status(400).json({ error: 'user param required' });
    const myGroups = Array.from(localGroups.values()).filter(g =>
        g.members.some(m => m.node === config.nodeName && m.user === user)
    );
    res.json(myGroups);
});

// Get group message history for a specific group
app.get('/api/group-messages', (req, res) => {
    const { groupId } = req.query;
    if (!groupId) return res.status(400).json({ error: 'groupId param required' });
    db.getGroupMessages(groupId, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Admin Auth Middleware
function adminAuth(req, res, next) {
    const requester = req.headers['x-username'];
    if (requester === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Access Denied: Admin authorization required.' });
    }
}

// Admin APIs
app.get('/api/admin/stats', adminAuth, (req, res) => {
    db.getAdminStats((err, stats) => {
        if (err) return res.status(500).json({ error: err.message });

        if (!config.cnodeUrl) {
            return res.json({
                ...stats,
                nodeType: config.nodeType || '',
                nodeName: config.nodeName || '',
                cnodeUrl: '',
                peers: [],
                cnodeStatus: 'Offline'
            });
        }

        const httpLib = require('http');
        try {
            const url = new URL(config.cnodeUrl);
            const request = httpLib.get({
                hostname: url.hostname,
                port: url.port,
                path: '/api/status'
            }, (response) => {
                let data = '';
                response.on('data', (chunk) => data += chunk);
                response.on('end', () => {
                    let peers = [];
                    try { peers = JSON.parse(data).nodes || []; } catch (e) { }
                    res.json({
                        ...stats,
                        nodeType: config.nodeType,
                        nodeName: config.nodeName,
                        cnodeUrl: config.cnodeUrl,
                        peers: peers,
                        cnodeStatus: 'Online'
                    });
                });
            });
            request.on('error', (err) => {
                res.json({
                    ...stats,
                    nodeType: config.nodeType,
                    nodeName: config.nodeName,
                    cnodeUrl: config.cnodeUrl,
                    peers: [],
                    cnodeStatus: 'Offline'
                });
            });
        } catch (e) {
            res.json({
                ...stats,
                nodeType: config.nodeType,
                nodeName: config.nodeName,
                cnodeUrl: config.cnodeUrl,
                peers: [],
                cnodeStatus: 'Offline'
            });
        }
    });
});

app.get('/api/admin/users', adminAuth, (req, res) => {
    db.getAllUsers((err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(users);
    });
});

app.delete('/api/admin/user/:username', adminAuth, (req, res) => {
    const { username } = req.params;
    if (username === 'admin') {
        return res.status(400).json({ error: 'Cannot delete the system administrator account.' });
    }
    db.deleteUser(username, (err, changes) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'ok', changes });
    });
});

app.get('/api/admin/logs', adminAuth, (req, res) => {
    res.json({ logs: serverLogs });
});

io.on('connection', (socket) => {
    let loggedInUser = null;

    socket.on('login', (username) => {
        loggedInUser = username;
        localUsers.set(username, socket.id);
        activeSessions.set(username, { socketId: socket.id, connectedAt: new Date().toISOString() });
        serverLog(`Local user connected: ${username}`);
        // Send this user their groups
        const myGroups = Array.from(localGroups.values()).filter(g =>
            g.members.some(m => m.node === config.nodeName && m.user === username)
        );
        socket.emit('groups_list', myGroups);
    });

    socket.on('send_message', (data) => {
        const { toUser, toNode, message } = data;
        const msgData = {
            fromUser: loggedInUser,
            fromNode: config.nodeName,
            toUser,
            toNode,
            message,
            timestamp: new Date().toISOString()
        };

        db.saveMessage(loggedInUser, config.nodeName, toUser, toNode, message, (err) => {
            if (err) serverLog('Error saving sent message: ' + err.message);
        });

        cnodeSocket.emit('route_message', msgData);
        socket.emit('chat_message', msgData);
    });

    // Create a new group and register it with the Federation Node
    socket.on('create_group', (data) => {
        const { groupId, name, members } = data;
        cnodeSocket.emit('create_group', {
            groupId,
            name,
            createdBy: { user: loggedInUser, node: config.nodeName },
            members
        });
    });

    // Send a message to a group
    socket.on('send_group_message', (data) => {
        const { groupId, message } = data;
        cnodeSocket.emit('group_message', {
            groupId,
            fromUser: loggedInUser,
            fromNode: config.nodeName,
            message
        });
    });

    socket.on('disconnect', () => {
        if (loggedInUser) {
            localUsers.delete(loggedInUser);
            activeSessions.delete(loggedInUser);
            serverLog(`Local user disconnected: ${loggedInUser}`);
        }
    });

    // ── Call signalling: Browser → Federation Node ───────────────────────────

    // Initiate a DM call
    socket.on('call_user', ({ toUser, toNode, offer, callId }) => {
        if (!loggedInUser || !cnodeSocket) return;
        cnodeSocket.emit('call_invite', {
            callId,
            fromUser: loggedInUser,
            fromNode: config.nodeName,
            toUser,
            toNode,
            offer
        });
    });

    // Send answer SDP to caller
    socket.on('call_answer', ({ toUser, toNode, answer, callId }) => {
        if (!loggedInUser || !cnodeSocket) return;
        cnodeSocket.emit('call_answer', {
            callId,
            fromUser: loggedInUser,
            fromNode: config.nodeName,
            toUser,
            toNode,
            answer
        });
    });

    // Reject incoming call
    socket.on('call_reject', ({ toUser, toNode, callId }) => {
        if (!loggedInUser || !cnodeSocket) return;
        cnodeSocket.emit('call_reject', {
            callId,
            fromUser: loggedInUser,
            fromNode: config.nodeName,
            toUser,
            toNode
        });
    });

    // Hang up (DM call)
    socket.on('call_hangup', ({ toUser, toNode, callId }) => {
        if (!loggedInUser || !cnodeSocket) return;
        cnodeSocket.emit('call_hangup', {
            callId,
            fromUser: loggedInUser,
            fromNode: config.nodeName,
            toUser,
            toNode
        });
    });

    // ICE candidate (DM call)
    socket.on('call_ice', ({ toUser, toNode, candidate, callId }) => {
        if (!loggedInUser || !cnodeSocket) return;
        cnodeSocket.emit('call_ice', {
            callId,
            fromUser: loggedInUser,
            fromNode: config.nodeName,
            toUser,
            toNode,
            candidate
        });
    });

    // Group call signalling (offer/answer/ICE between group members)
    socket.on('group_call_signal', (data) => {
        if (!loggedInUser || !cnodeSocket) return;
        cnodeSocket.emit('group_call_signal', {
            ...data,
            fromUser: loggedInUser,
            fromNode: config.nodeName
        });
    });
});

// ── Profile / Avatar APIs ──────────────────────────────────────────────────

// Upload avatar
app.post('/api/profile/avatar', upload.single('avatar'), (req, res) => {
    const username = req.headers['x-username'];
    if (!username) return res.status(401).json({ error: 'Not authenticated' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const ext = path.extname(req.file.originalname) || '.jpg';
    const avatarUrl = `/avatars/${username}${ext}`;
    db.updateUserAvatar(username, avatarUrl, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'ok', avatarUrl });
    });
});

// Get own profile (includes avatar_url)
app.get('/api/profile', (req, res) => {
    const username = req.headers['x-username'];
    if (!username) return res.status(401).json({ error: 'Not authenticated' });
    db.getUserProfile(username, (err, profile) => {
        if (err || !profile) return res.status(404).json({ error: 'User not found' });
        res.json(profile);
    });
});

// Public profile lookup — any logged-in user can view another local user's profile
app.get('/api/profile/:username', (req, res) => {
    const requester = req.headers['x-username'] || (verifyToken(req.cookies[TOKEN_COOKIE]) || {}).username;
    if (!requester) return res.status(401).json({ error: 'Not authenticated' });
    db.getUserProfile(req.params.username, (err, profile) => {
        if (err || !profile) return res.status(404).json({ error: 'User not found' });
        // Return public-safe fields only (no banned status exposed)
        res.json({
            username: profile.username,
            display_name: profile.display_name,
            bio: profile.bio,
            avatar_url: profile.avatar_url
        });
    });
});

// Update own display name + bio
app.put('/api/profile', (req, res) => {
    const username = req.headers['x-username'];
    if (!username) return res.status(401).json({ error: 'Not authenticated' });
    const { displayName, bio } = req.body;
    db.updateUserProfile(username, displayName || username, bio || '', (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ status: 'ok' });
    });
});

// ── Admin ban / unban ──────────────────────────────────────────────────────

app.post('/api/admin/user/:username/ban', adminAuth, (req, res) => {
    const { username } = req.params;
    if (username === 'admin') return res.status(400).json({ error: 'Cannot ban the admin account.' });
    db.banUser(username, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        // Kick the user if online
        const sid = localUsers.get(username);
        if (sid) { io.to(sid).emit('banned'); localUsers.delete(username); activeSessions.delete(username); }
        serverLog(`Admin banned user: ${username}`);
        res.json({ status: 'ok' });
    });
});

app.post('/api/admin/user/:username/unban', adminAuth, (req, res) => {
    const { username } = req.params;
    db.unbanUser(username, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        serverLog(`Admin unbanned user: ${username}`);
        res.json({ status: 'ok' });
    });
});

// Enrich admin stats with uptime and active sessions
app.get('/api/admin/sessions', adminAuth, (req, res) => {
    const sessions = Array.from(activeSessions.entries()).map(([user, info]) => ({
        username: user,
        connectedAt: info.connectedAt
    }));
    res.json({ sessions, uptime: Math.floor((Date.now() - startTime) / 1000) });
});

// Run Setup immediately or Chat App directly if already configured
if (isInstalled) {
    initializeChatApp();
}

server.listen(PORT, () => {
    serverLog(`Node Application running on port ${PORT}`);
});
