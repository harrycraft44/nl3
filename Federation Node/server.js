const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Persistent node name registry ─────────────────────────────────────────────
const REGISTRY_FILE = path.join(__dirname, 'nodes-registry.json');
function loadRegistry() {
    if (fs.existsSync(REGISTRY_FILE)) {
        try { return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')); } catch (e) {}
    }
    return {};
}
function saveRegistry(registry) {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}
let nameRegistry = loadRegistry();

// ── Persistent group registry ─────────────────────────────────────────────────
// { [groupId]: { groupId, name, createdBy: {user,node}, members: [{user,node}], createdAt } }
const GROUPS_FILE = path.join(__dirname, 'groups-registry.json');
function loadGroups() {
    if (fs.existsSync(GROUPS_FILE)) {
        try { return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8')); } catch (e) {}
    }
    return {};
}
function saveGroups(groups) {
    fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
}
let groupsRegistry = loadGroups();

// ── Active connections ─────────────────────────────────────────────────────────
// nodes: Map<nodeName, socket.id>
const nodes = new Map();

// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
    res.json({ nodes: Array.from(nodes.keys()) });
});

app.get('/api/registry', (req, res) => {
    res.json(nameRegistry);
});

app.get('/api/groups', (req, res) => {
    res.json(Object.values(groupsRegistry));
});

// ── Socket handlers ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`[CNode] New connection: ${socket.id}`);

    // ── Node registration ────────────────────────────────────────────────────
    socket.on('register_node', ({ nodeId, uuid } = {}) => {
        if (!nodeId || !uuid) {
            socket.emit('register_error', { error: 'Registration requires both nodeId and uuid.' });
            return;
        }

        const registeredUuid = nameRegistry[nodeId];
        if (registeredUuid) {
            if (registeredUuid !== uuid) {
                console.log(`[CNode] Registration rejected: "${nodeId}" is owned by a different UUID`);
                socket.emit('register_error', {
                    error: `Node name "${nodeId}" is already permanently reserved by another node.`
                });
                return;
            }
            console.log(`[CNode] Node reconnected: ${nodeId} (uuid: ${uuid})`);
        } else {
            nameRegistry[nodeId] = uuid;
            saveRegistry(nameRegistry);
            console.log(`[CNode] New node registered: ${nodeId} → UUID ${uuid}`);
        }

        nodes.set(nodeId, socket.id);
        socket.emit('registered', { status: 'ok', nodeId, uuid });
        io.emit('nodes_updated', Array.from(nodes.keys()));

        // Send this node its group memberships on connect
        const myGroups = Object.values(groupsRegistry).filter(g =>
            g.members.some(m => m.node === nodeId)
        );
        if (myGroups.length > 0) {
            socket.emit('my_groups', myGroups);
        }
    });

    // ── Group: create ────────────────────────────────────────────────────────
    socket.on('create_group', (data) => {
        const { groupId, name, createdBy, members } = data;
        if (!groupId || !name || !members || members.length < 1) {
            socket.emit('group_error', { error: 'Invalid group creation data.' });
            return;
        }

        if (groupsRegistry[groupId]) {
            socket.emit('group_error', { error: 'Group ID already exists.' });
            return;
        }

        const group = {
            groupId,
            name,
            createdBy,
            members,
            createdAt: new Date().toISOString()
        };

        groupsRegistry[groupId] = group;
        saveGroups(groupsRegistry);
        console.log(`[CNode] Group created: "${name}" (${groupId}) by ${createdBy.user}@${createdBy.node}`);

        // Notify all unique member nodes that are currently connected
        const notifiedNodes = new Set();
        members.forEach(member => {
            if (!notifiedNodes.has(member.node)) {
                notifiedNodes.add(member.node);
                const targetSocketId = nodes.get(member.node);
                if (targetSocketId) {
                    io.to(targetSocketId).emit('group_created', group);
                }
            }
        });
    });

    // ── Group: get groups for a node ─────────────────────────────────────────
    socket.on('get_my_groups', ({ nodeName }) => {
        const myGroups = Object.values(groupsRegistry).filter(g =>
            g.members.some(m => m.node === nodeName)
        );
        socket.emit('my_groups', myGroups);
    });

    // ── Group: message fan-out ───────────────────────────────────────────────
    socket.on('group_message', (data) => {
        const { groupId, fromUser, fromNode, message } = data;
        const group = groupsRegistry[groupId];
        if (!group) {
            socket.emit('group_error', { error: `Group "${groupId}" not found.` });
            return;
        }

        console.log(`[CNode] Group message in "${group.name}" from ${fromUser}@${fromNode}`);

        const payload = {
            groupId,
            groupName: group.name,
            fromUser,
            fromNode,
            message,
            timestamp: new Date().toISOString()
        };

        // Fan out to all unique member nodes
        const notifiedNodes = new Set();
        group.members.forEach(member => {
            if (!notifiedNodes.has(member.node)) {
                notifiedNodes.add(member.node);
                const targetSocketId = nodes.get(member.node);
                if (targetSocketId) {
                    io.to(targetSocketId).emit('receive_group_message', payload);
                }
            }
        });
    });

    // ── Direct message routing ───────────────────────────────────────────────
    socket.on('route_message', (data) => {
        const { toNode, fromNode, toUser, fromUser } = data;
        console.log(`[CNode] Routing message from ${fromUser}@${fromNode} to ${toUser}@${toNode}`);
        io.emit('route_activity', data);

        const targetSocketId = nodes.get(toNode);
        if (targetSocketId) {
            io.to(targetSocketId).emit('receive_message', data);
            console.log(`[CNode] Message delivered to ${toNode}`);
        } else {
            console.log(`[CNode] Target node ${toNode} not connected`);
            socket.emit('route_error', {
                error: `Node "${toNode}" is offline.`,
                fromUser, toUser, toNode
            });
        }
    });

    // ── Error report relay ───────────────────────────────────────────────────
    socket.on('route_error_report', (data) => {
        const { error, fromUser, fromNode, toUser, toNode } = data;
        const senderSocketId = nodes.get(fromNode);
        if (senderSocketId) {
            io.to(senderSocketId).emit('route_error', { error, fromUser, toUser, toNode });
        }
    });

    // ── Call signalling relay ────────────────────────────────────────────────
    // All events follow the same pattern: look up the target node socket and
    // forward the payload verbatim. The Community Nodes handle delivery to
    // the specific browser socket.

    // Caller initiates a call to another user (DM call)
    socket.on('call_invite', (data) => {
        const { toNode } = data;
        console.log(`[CNode] Call invite: ${data.fromUser}@${data.fromNode} → ${data.toUser}@${toNode}`);
        const targetSocketId = nodes.get(toNode);
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_call', data);
        } else {
            socket.emit('call_error', { error: `Node "${toNode}" is offline.`, callId: data.callId });
        }
    });

    // Callee sends answer SDP back to caller's node
    socket.on('call_answer', (data) => {
        const { toNode } = data;
        const targetSocketId = nodes.get(toNode);
        if (targetSocketId) io.to(targetSocketId).emit('call_answered', data);
    });

    // Callee rejects the call
    socket.on('call_reject', (data) => {
        const { toNode } = data;
        const targetSocketId = nodes.get(toNode);
        if (targetSocketId) io.to(targetSocketId).emit('call_rejected', data);
    });

    // Either party hangs up (DM or group)
    socket.on('call_hangup', (data) => {
        const { toNode } = data;
        if (toNode) {
            const targetSocketId = nodes.get(toNode);
            if (targetSocketId) io.to(targetSocketId).emit('call_ended', data);
        }
    });

    // ICE candidate relay (DM calls)
    socket.on('call_ice', (data) => {
        const { toNode } = data;
        const targetSocketId = nodes.get(toNode);
        if (targetSocketId) io.to(targetSocketId).emit('call_ice', data);
    });

    // Group call signalling — fan-out to all member nodes
    socket.on('group_call_signal', (data) => {
        const { groupId, toNode } = data;
        if (toNode) {
            // Targeted signal (offer/answer/ICE between two peers in a group)
            const targetSocketId = nodes.get(toNode);
            if (targetSocketId) io.to(targetSocketId).emit('group_call_signal', data);
        } else if (groupId) {
            // Broadcast to all member nodes (call_start announcement)
            const group = groupsRegistry[groupId];
            if (!group) return;
            const notifiedNodes = new Set();
            group.members.forEach(member => {
                if (!notifiedNodes.has(member.node)) {
                    notifiedNodes.add(member.node);
                    const sid = nodes.get(member.node);
                    if (sid) io.to(sid).emit('group_call_signal', data);
                }
            });
        }
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
        let disconnectedNode = null;
        for (const [nodeId, id] of nodes.entries()) {
            if (id === socket.id) {
                disconnectedNode = nodeId;
                nodes.delete(nodeId);
                break;
            }
        }
        if (disconnectedNode) {
            console.log(`[CNode] Node disconnected: ${disconnectedNode}`);
            io.emit('nodes_updated', Array.from(nodes.keys()));
        } else {
            console.log(`[CNode] Connection lost: ${socket.id}`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Federation Node (CNode) running on port ${PORT}`);
    console.log(`[CNode] ${Object.keys(nameRegistry).length} reserved node name(s), ${Object.keys(groupsRegistry).length} group(s) loaded`);
});
