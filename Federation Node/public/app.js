const socket = io();

const nodeCount = document.getElementById('node-count');
const nodesList = document.getElementById('nodes-list');
const activityLog = document.getElementById('activity-log');

function updateNodesList(nodes) {
    nodeCount.textContent = nodes.length;
    nodesList.innerHTML = '';
    if (nodes.length === 0) {
        nodesList.innerHTML = '<li>No nodes connected</li>';
        return;
    }
    nodes.forEach(node => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${node}</strong> <span class="badge-online">Online</span>`;
        nodesList.appendChild(li);
    });
}

function logActivity(msg) {
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    div.textContent = `[${time}] ${msg}`;
    activityLog.appendChild(div);
    activityLog.scrollTop = activityLog.scrollHeight;
}

// Initial fetch
fetch('/api/status')
    .then(res => res.json())
    .then(data => updateNodesList(data.nodes));

// Listen for updates
socket.on('nodes_updated', (nodes) => {
    updateNodesList(nodes);
    logActivity('Node topology updated.');
});

socket.on('route_activity', (data) => {
    logActivity(`Routed message from ${data.fromUser}@${data.fromNode} to ${data.toUser}@${data.toNode}`);
});
