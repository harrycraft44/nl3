const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.resolve(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Create users table with metadata
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT,
        display_name TEXT,
        bio TEXT,
        avatar_url TEXT,
        banned INTEGER DEFAULT 0
    )`);
    // Migrate existing databases that lack the new columns
    db.run(`ALTER TABLE users ADD COLUMN avatar_url TEXT`, () => {});
    db.run(`ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0`, () => {});

    // Create direct messages table
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fromUser TEXT,
        fromNode TEXT,
        toUser TEXT,
        toNode TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create group messages table
    db.run(`CREATE TABLE IF NOT EXISTS group_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        groupId   TEXT,
        fromUser  TEXT,
        fromNode  TEXT,
        message   TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

function registerUser(username, password, displayName, bio, callback) {
    bcrypt.hash(password, 10, (err, hash) => {
        if (err) return callback(err);
        const name = displayName || username;
        const biography = bio || '';
        db.run(`INSERT INTO users (username, password_hash, display_name, bio) VALUES (?, ?, ?, ?)`, 
            [username, hash, name, biography], 
            function(err) {
                if (err && err.message.includes('UNIQUE constraint failed')) {
                    return callback(new Error('User already exists'));
                }
                callback(err, this.lastID);
            }
        );
    });
}

function verifyUser(username, password, callback) {
    db.get(`SELECT password_hash FROM users WHERE username = ?`, [username], (err, row) => {
        if (err) return callback(err);
        if (!row) return callback(null, false);
        bcrypt.compare(password, row.password_hash, (err, res) => {
            if (err) return callback(err);
            callback(null, res);
        });
    });
}

function getUserProfile(username, callback) {
    db.get(`SELECT username, display_name, bio, avatar_url, banned FROM users WHERE username = ?`, [username], (err, row) => {
        callback(err, row);
    });
}

function updateUserAvatar(username, avatarUrl, callback) {
    db.run(`UPDATE users SET avatar_url = ? WHERE username = ?`, [avatarUrl, username], function(err) {
        if (callback) callback(err, this.changes);
    });
}

function updateUserProfile(username, displayName, bio, callback) {
    db.run(`UPDATE users SET display_name = ?, bio = ? WHERE username = ?`, [displayName, bio, username], function(err) {
        if (callback) callback(err, this.changes);
    });
}

function banUser(username, callback) {
    db.run(`UPDATE users SET banned = 1 WHERE username = ?`, [username], function(err) {
        if (callback) callback(err, this.changes);
    });
}

function unbanUser(username, callback) {
    db.run(`UPDATE users SET banned = 0 WHERE username = ?`, [username], function(err) {
        if (callback) callback(err, this.changes);
    });
}

function saveMessage(fromUser, fromNode, toUser, toNode, message, callback) {
    db.run(`INSERT INTO messages (fromUser, fromNode, toUser, toNode, message) VALUES (?, ?, ?, ?, ?)`,
        [fromUser, fromNode, toUser, toNode, message],
        function(err) {
            if (callback) callback(err, this.lastID);
        });
}

function getMessages(user1, node1, user2, node2, callback) {
    db.all(`SELECT * FROM messages 
            WHERE (fromUser = ? AND fromNode = ? AND toUser = ? AND toNode = ?)
               OR (fromUser = ? AND fromNode = ? AND toUser = ? AND toNode = ?)
            ORDER BY timestamp ASC`,
        [user1, node1, user2, node2, user2, node2, user1, node1],
        (err, rows) => {
            if (callback) callback(err, rows);
        });
}

function checkAdminExists(callback) {
    db.get(`SELECT COUNT(*) as count FROM users WHERE username = 'admin'`, (err, row) => {
        callback(err, row && row.count > 0);
    });
}

function getAdminStats(callback) {
    db.get(`SELECT COUNT(*) as count FROM users`, (err, userRow) => {
        if (err) return callback(err);
        db.get(`SELECT COUNT(*) as count FROM messages`, (err, msgRow) => {
            if (err) return callback(err);
            callback(null, {
                userCount: userRow ? userRow.count : 0,
                messageCount: msgRow ? msgRow.count : 0
            });
        });
    });
}

function getAllUsers(callback) {
    db.all(`SELECT username, display_name, bio, avatar_url, banned FROM users ORDER BY username ASC`, (err, rows) => {
        callback(err, rows);
    });
}

function deleteUser(username, callback) {
    db.run(`DELETE FROM users WHERE username = ?`, [username], function(err) {
        callback(err, this.changes);
    });
}

function saveGroupMessage(groupId, fromUser, fromNode, message, callback) {
    db.run(
        `INSERT INTO group_messages (groupId, fromUser, fromNode, message) VALUES (?, ?, ?, ?)`,
        [groupId, fromUser, fromNode, message],
        function(err) { if (callback) callback(err, this.lastID); }
    );
}

function getGroupMessages(groupId, callback) {
    db.all(
        `SELECT * FROM group_messages WHERE groupId = ? ORDER BY timestamp ASC`,
        [groupId],
        (err, rows) => { if (callback) callback(err, rows); }
    );
}

module.exports = {
    registerUser,
    verifyUser,
    getUserProfile,
    updateUserAvatar,
    updateUserProfile,
    banUser,
    unbanUser,
    saveMessage,
    getMessages,
    checkAdminExists,
    getAdminStats,
    getAllUsers,
    deleteUser,
    saveGroupMessage,
    getGroupMessages
};
