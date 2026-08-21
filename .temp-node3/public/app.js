const socket = io();

// ── State ────────────────────────────────────────────────
let myUsername  = '';
let myNodeName  = '';
let myAvatarUrl = '';
let currentTargetUser = '';
let currentTargetNode = '';
let activeChats = new Set();
let myGroups    = [];
let currentGroupId = null;
let currentTab  = 'messages';
let currentAdminTab = 'overview';

// Unread counters (cleared when user switches to that tab/conversation)
const dmUnread    = {};   // key -> count
const groupUnread = {};   // groupId -> count

// ── Auth DOM ─────────────────────────────────────────────
const loginScreen  = document.getElementById('login-screen');
const appLayout    = document.getElementById('app-layout');
const loginFrame   = document.getElementById('login-frame');
const signupFrame  = document.getElementById('signup-frame');
const loginForm    = document.getElementById('login-form');
const signupForm   = document.getElementById('signup-form');
const usernameInput          = document.getElementById('username');
const passwordInput          = document.getElementById('password');
const signupUsernameInput    = document.getElementById('signup-username');
const signupDisplayNameInput = document.getElementById('signup-displayname');
const signupPasswordInput    = document.getElementById('signup-password');
const signupBioInput         = document.getElementById('signup-bio');

document.getElementById('go-to-signup').addEventListener('click', e => { e.preventDefault(); loginFrame.style.display='none'; signupFrame.style.display='block'; });
document.getElementById('go-to-login').addEventListener('click',  e => { e.preventDefault(); signupFrame.style.display='none'; loginFrame.style.display='block'; });

// Fetch node name early
fetch('/api/info').then(r=>r.json()).then(d=>{
    myNodeName = d.nodeName;
    document.querySelectorAll('.node-name-label').forEach(el=>el.textContent=myNodeName);
});

// ── Login ─────────────────────────────────────────────────
loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) return;
    fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username, password}) })
        .then(r => { if (!r.ok) return r.json().then(e=>{throw new Error(e.error||'Login failed')}); return r.json(); })
        .then(d => { myUsername=d.username; myNodeName=d.nodeName; socket.emit('login', myUsername); initApp(); })
        .catch(err => alert(err.message));
});

// ── Signup ────────────────────────────────────────────────
signupForm.addEventListener('submit', e => {
    e.preventDefault();
    const username    = signupUsernameInput.value.trim();
    const displayName = signupDisplayNameInput.value.trim();
    const password    = signupPasswordInput.value;
    const bio         = signupBioInput.value.trim();
    if (!username || !password) return;
    fetch('/api/signup', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username, password, displayName, bio}) })
        .then(r => { if (!r.ok) return r.json().then(e=>{throw new Error(e.error||'Signup failed')}); return r.json(); })
        .then(d => { myUsername=d.username; myNodeName=d.nodeName; socket.emit('login', myUsername); initApp(); })
        .catch(err => alert(err.message));
});

// ═══════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════
const toastContainer = document.getElementById('toast-container');

function showToast({ type = 'dm', icon, title, text, onClick }) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon"><i class="fa-solid ${icon}"></i></span>
        <div class="toast-body">
            <span class="toast-title">${title}</span>
            <span class="toast-text">${text}</span>
        </div>`;

    if (onClick) toast.addEventListener('click', () => { onClick(); dismissToast(toast); });
    else         toast.addEventListener('click', () => dismissToast(toast));

    toastContainer.appendChild(toast);

    // Auto-dismiss after 5s
    const timer = setTimeout(() => dismissToast(toast), 5000);
    toast._timer = timer;
}

function dismissToast(toast) {
    if (!toast.parentNode) return;
    clearTimeout(toast._timer);
    toast.style.animation = 'toastOut 0.2s ease forwards';
    setTimeout(() => toast.remove(), 200);
}

// Browser notification (ask permission once after login)
function requestNotifPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function sendBrowserNotif(title, body, onClick) {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(title, { body, icon: '/favicon.ico' });
        if (onClick) n.onclick = () => { window.focus(); onClick(); n.close(); };
    }
}

// ═══════════════════════════════════════════════════════
// BADGE MANAGEMENT
// ═══════════════════════════════════════════════════════
function updateDmBadge() {
    const total = Object.values(dmUnread).reduce((a,b)=>a+b, 0);
    const el = document.getElementById('badge-messages');
    if (total > 0) { el.textContent = total > 99 ? '99+' : total; el.style.display='flex'; }
    else           { el.style.display='none'; }
}

function updateGroupBadge() {
    const total = Object.values(groupUnread).reduce((a,b)=>a+b, 0);
    const el = document.getElementById('badge-groups');
    if (total > 0) { el.textContent = total > 99 ? '99+' : total; el.style.display='flex'; }
    else           { el.style.display='none'; }
}

// ═══════════════════════════════════════════════════════
// AVATAR HELPERS
// ═══════════════════════════════════════════════════════
function setRailAvatar(url) {
    const img = document.getElementById('my-avatar-img');
    const initial = document.getElementById('my-avatar-initial');
    if (url) {
        img.src = url;
        img.style.display = 'block';
        initial.style.display = 'none';
    } else {
        img.style.display = 'none';
        initial.style.display = 'block';
    }
}

function setSettingsAvatar(url) {
    const img = document.getElementById('settings-avatar-img');
    const initial = document.getElementById('settings-avatar-initial');
    if (url) {
        img.src = url;
        img.style.display = 'block';
        initial.style.display = 'none';
    } else {
        img.style.display = 'none';
        initial.style.display = 'block';
    }
}

function makeAvatarEl(username, avatarUrl) {
    const wrap = document.createElement('div');
    wrap.className = 'si-avatar';
    if (avatarUrl) {
        const img = document.createElement('img');
        img.src = avatarUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;';
        wrap.appendChild(img);
    } else {
        wrap.textContent = username.charAt(0).toUpperCase();
    }
    return wrap;
}

// ═══════════════════════════════════════════════════════
// APP INIT
// ═══════════════════════════════════════════════════════
function initApp() {
    document.getElementById('my-avatar-initial').textContent = myUsername.charAt(0).toUpperCase();
    document.getElementById('settings-avatar-initial').textContent = myUsername.charAt(0).toUpperCase();
    document.getElementById('my-name').textContent   = myUsername;
    document.getElementById('my-node').textContent   = '@' + myNodeName;
    document.getElementById('settings-username').value    = myUsername;
    document.getElementById('settings-node').value        = '@' + myNodeName;

    if (myUsername.toLowerCase() === 'admin') {
        document.getElementById('admin-rail-btn').style.display = 'flex';
    }

    loginScreen.classList.remove('active');
    appLayout.classList.add('active');

    requestNotifPermission();

    // Load profile to get avatar + display name + bio
    fetch('/api/profile', { headers: { 'x-username': myUsername } })
        .then(r => r.json())
        .then(p => {
            myAvatarUrl = p.avatar_url || '';
            setRailAvatar(myAvatarUrl);
            setSettingsAvatar(myAvatarUrl);
            document.getElementById('settings-displayname').value = p.display_name || myUsername;
            document.getElementById('settings-bio').value = p.bio || '';
        }).catch(() => {});
}

// ═══════════════════════════════════════════════════════
// SETTINGS — profile save & avatar upload
// ═══════════════════════════════════════════════════════
document.getElementById('settings-save-btn').addEventListener('click', () => {
    const displayName = document.getElementById('settings-displayname').value.trim();
    const bio         = document.getElementById('settings-bio').value.trim();
    fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-username': myUsername },
        body: JSON.stringify({ displayName, bio })
    }).then(r => r.json()).then(d => {
        if (d.status === 'ok') {
            const msg = document.getElementById('settings-save-msg');
            msg.style.display = 'block';
            setTimeout(() => msg.style.display = 'none', 3000);
        }
    }).catch(() => {});
});

document.getElementById('avatar-file-input').addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('avatar', file);
    fetch('/api/profile/avatar', {
        method: 'POST',
        headers: { 'x-username': myUsername },
        body: formData
    }).then(r => r.json()).then(d => {
        if (d.avatarUrl) {
            myAvatarUrl = d.avatarUrl + '?t=' + Date.now(); // cache-bust
            setRailAvatar(myAvatarUrl);
            setSettingsAvatar(myAvatarUrl);
            showToast({ type:'dm', icon:'fa-circle-check', title:'Avatar updated', text:'Your profile photo has been saved.' });
        }
    }).catch(() => alert('Upload failed.'));
});

// ═══════════════════════════════════════════════════════
// NAVIGATION — icon rail + panel switching
// ═══════════════════════════════════════════════════════
const railBtns    = document.querySelectorAll('.rail-btn[data-tab]');
const tabSections = document.querySelectorAll('.tab-content');
const panelViews  = document.querySelectorAll('.panel-view');

railBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        currentTab = tab;

        railBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tabSections.forEach(s => s.classList.remove('active'));
        document.getElementById('tab-' + tab).classList.add('active');
        panelViews.forEach(p => p.style.display='none');
        const pv = document.getElementById('panel-' + tab);
        if (pv) { pv.style.display='flex'; pv.style.flexDirection='column'; pv.style.height='100%'; }

        if (tab === 'admin-panel') loadAdminPanel();
    });
});

// Init panel visibility
panelViews.forEach(p => { p.style.display='none'; p.style.flexDirection='column'; p.style.height='100%'; });
document.getElementById('panel-messages').style.display='flex';

// ── Admin sub-navigation ──────────────────────────────
document.querySelectorAll('[data-admin-tab]').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('[data-admin-tab]').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        const tab = item.dataset.adminTab;
        currentAdminTab = tab;
        document.querySelectorAll('.admin-sub').forEach(s => s.style.display = 'none');
        const sub = document.getElementById('admin-sub-' + tab);
        if (sub) sub.style.display = 'block';

        // Load data for the selected sub-tab
        if (tab === 'users')    loadAdminUsers();
        if (tab === 'sessions') refreshAdminSessions();
        if (tab === 'logs')     refreshAdminLogs();
    });
});

// ═══════════════════════════════════════════════════════
// DIRECT MESSAGES
// ═══════════════════════════════════════════════════════
const targetHandleInput = document.getElementById('target-handle');
const startChatBtn      = document.getElementById('start-chat-btn');
const chatHeader        = document.getElementById('chat-header');
const chatWelcome       = document.getElementById('chat-welcome');
const messagesContainer = document.getElementById('messages');
const messageForm       = document.getElementById('message-form');
const messageTextInput  = document.getElementById('message-text');

startChatBtn.addEventListener('click', () => {
    const handle = targetHandleInput.value.trim();
    if (!handle) return;
    let tUser = handle, tNode = myNodeName;
    if (handle.includes('@')) [tUser, tNode] = handle.split('@');
    startChat(tUser.trim(), tNode.trim());
    targetHandleInput.value = '';
});
targetHandleInput.addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); startChatBtn.click(); } });

function startChat(tUser, tNode) {
    if (tUser===myUsername && tNode===myNodeName) { alert('You cannot message yourself.'); return; }
    currentTargetUser = tUser;
    currentTargetNode = tNode;
    const key = tUser + '@' + tNode;
    activeChats.add(key);

    // Clear unread for this conversation
    dmUnread[key] = 0;
    updateDmBadge();

    renderActiveChats();

    chatWelcome.style.display = 'none';
    messagesContainer.style.display = 'flex';

    chatHeader.innerHTML = `
        <span class="chat-header-icon"><i class="fa-solid fa-message"></i></span>
        <div class="chat-header-info">
            <h2>${tUser}</h2>
            <p class="subtitle">@${tNode}</p>
        </div>`;
    messageForm.style.display = 'flex';
    loadMessages();
    messageTextInput.focus();
}

function renderActiveChats() {
    const container = document.getElementById('active-chats');
    container.innerHTML = '';
    if (activeChats.size === 0) {
        container.innerHTML = '<div class="panel-empty">No conversations yet.<br>Type a handle above to start.</div>';
        return;
    }
    activeChats.forEach(key => {
        const [user, node] = key.split('@');
        const isActive  = user===currentTargetUser && node===currentTargetNode;
        const unread    = dmUnread[key] || 0;
        const el = document.createElement('div');
        el.className = 'section-item' + (isActive ? ' active' : '');
        el.innerHTML = `
            <div class="si-avatar">${user.charAt(0).toUpperCase()}</div>
            <div class="si-info">
                <span class="si-name">${user}</span>
                <span class="si-sub">@${node}</span>
            </div>
            ${unread > 0 ? `<span class="unread-dot" title="${unread} unread"></span>` : ''}`;
        el.addEventListener('click', () => {
            dmUnread[key] = 0;
            updateDmBadge();
            startChat(user, node);
        });
        container.appendChild(el);
    });
}

function loadMessages() {
    fetch(`/api/messages?user=${myUsername}&targetUser=${currentTargetUser}&targetNode=${currentTargetNode}`)
        .then(r => r.json())
        .then(msgs => { messagesContainer.innerHTML=''; msgs.forEach(m=>appendMessage(m)); scrollToBottom(messagesContainer); });
}

messageForm.addEventListener('submit', e => {
    e.preventDefault();
    const text = messageTextInput.value.trim();
    if (!text || !currentTargetUser) return;
    socket.emit('send_message', { toUser: currentTargetUser, toNode: currentTargetNode, message: text });
    messageTextInput.value = '';
});

socket.on('chat_message', data => {
    const isMe = data.fromUser===myUsername && data.fromNode===myNodeName;
    const key  = isMe ? data.toUser+'@'+data.toNode : data.fromUser+'@'+data.fromNode;
    activeChats.add(key);

    const isCurrentConvo = (data.fromUser===currentTargetUser && data.fromNode===currentTargetNode) ||
                           (isMe && data.toUser===currentTargetUser && data.toNode===currentTargetNode);
    const isViewingDms   = currentTab === 'messages';

    if (isCurrentConvo && isViewingDms) {
        appendMessage(data);
        scrollToBottom(messagesContainer);
    } else if (!isMe) {
        // Incoming message we're not currently viewing — badge + toast
        dmUnread[key] = (dmUnread[key] || 0) + 1;
        updateDmBadge();
        renderActiveChats();

        const senderLabel = `${data.fromUser}@${data.fromNode}`;
        showToast({
            type: 'dm',
            icon: 'fa-message',
            title: senderLabel,
            text: data.message.length > 60 ? data.message.slice(0,60)+'…' : data.message,
            onClick: () => {
                document.querySelector('.rail-btn[data-tab="messages"]').click();
                startChat(data.fromUser, data.fromNode);
            }
        });
        sendBrowserNotif(senderLabel, data.message, () => {
            document.querySelector('.rail-btn[data-tab="messages"]').click();
            startChat(data.fromUser, data.fromNode);
        });
    } else {
        // Our own message echoed, keep chat list updated
        renderActiveChats();
    }
});

socket.on('message_error', data => {
    showToast({ type:'error', icon:'fa-circle-exclamation', title:'Message not delivered', text: data.error });
});

// Kicked/banned
socket.on('banned', () => {
    alert('You have been banned from this node.');
    location.reload();
});

function appendMessage(msg) {
    const isOut = msg.fromUser===myUsername && msg.fromNode===myNodeName;
    const div = document.createElement('div');
    div.className = 'message ' + (isOut ? 'msg-out' : 'msg-in');
    const textDiv = document.createElement('div');
    textDiv.textContent = msg.message;
    div.appendChild(textDiv);
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    if (msg.timestamp) {
        const d = new Date(msg.timestamp.endsWith('Z') ? msg.timestamp : msg.timestamp+'Z');
        if (!isNaN(d)) meta.textContent = d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    }
    div.appendChild(meta);
    messagesContainer.appendChild(div);
}

function scrollToBottom(el) { el.scrollTop = el.scrollHeight; }

// ═══════════════════════════════════════════════════════
// GROUP CHAT
// ═══════════════════════════════════════════════════════
const groupChatHeader  = document.getElementById('group-chat-header');
const groupWelcome     = document.getElementById('group-welcome');
const groupMessagesEl  = document.getElementById('group-messages');
const groupMessageForm = document.getElementById('group-message-form');
const groupMessageText = document.getElementById('group-message-text');
const newGroupBtn      = document.getElementById('new-group-btn');
const groupModal       = document.getElementById('group-modal');
const modalClose       = document.getElementById('modal-close');
const modalCancel      = document.getElementById('modal-cancel');
const createGroupBtn   = document.getElementById('create-group-btn');
const groupNameInput   = document.getElementById('group-name-input');
const memberHandleInput = document.getElementById('member-handle-input');
const addMemberBtn     = document.getElementById('add-member-btn');
const memberChipsEl    = document.getElementById('member-chips');
let pendingMembers = [];

function openModal()  { pendingMembers=[]; groupNameInput.value=''; memberHandleInput.value=''; memberChipsEl.innerHTML=''; groupModal.style.display='flex'; setTimeout(()=>groupNameInput.focus(),50); }
function closeModal() { groupModal.style.display='none'; }

newGroupBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modalCancel.addEventListener('click', closeModal);
groupModal.addEventListener('click', e => { if(e.target===groupModal) closeModal(); });

function addMemberChip(user, node) {
    if (pendingMembers.find(m=>m.user===user&&m.node===node)) return;
    pendingMembers.push({user, node});
    const chip = document.createElement('div');
    chip.className = 'member-chip';
    chip.innerHTML = `${user}@${node} <span class="chip-remove" title="Remove"><i class="fa-solid fa-xmark"></i></span>`;
    chip.querySelector('.chip-remove').addEventListener('click', () => {
        pendingMembers = pendingMembers.filter(m=>!(m.user===user&&m.node===node));
        chip.remove();
    });
    memberChipsEl.appendChild(chip);
    memberHandleInput.value=''; memberHandleInput.focus();
}

addMemberBtn.addEventListener('click', () => {
    const val = memberHandleInput.value.trim();
    if (!val) return;
    let user=val, node=myNodeName;
    if (val.includes('@')) [user, node] = val.split('@');
    addMemberChip(user.trim(), node.trim());
});
memberHandleInput.addEventListener('keydown', e => { if(e.key==='Enter'){e.preventDefault();addMemberBtn.click();} });

createGroupBtn.addEventListener('click', () => {
    const name = groupNameInput.value.trim();
    if (!name) { groupNameInput.focus(); return; }
    const allMembers = [{user:myUsername, node:myNodeName}, ...pendingMembers.filter(m=>!(m.user===myUsername&&m.node===myNodeName))];
    const groupId = crypto.randomUUID();
    socket.emit('create_group', {groupId, name, members: allMembers});
    closeModal();
});

function renderGroupsList() {
    const container = document.getElementById('groups-list');
    container.innerHTML = '';
    if (myGroups.length === 0) {
        container.innerHTML = '<div class="panel-empty">No groups yet.<br>Click + to create one.</div>';
        return;
    }
    myGroups.forEach(g => {
        const unread = groupUnread[g.groupId] || 0;
        const el = document.createElement('div');
        el.className = 'section-item' + (g.groupId===currentGroupId ? ' active' : '');
        el.innerHTML = `
            <div class="si-avatar"><i class="fa-solid fa-people-group" style="font-size:12px;"></i></div>
            <div class="si-info">
                <span class="si-name">${g.name}</span>
                <span class="si-sub">${g.members.length} members</span>
            </div>
            ${unread > 0 ? `<span class="unread-dot" title="${unread} unread"></span>` : ''}`;
        el.addEventListener('click', () => {
            groupUnread[g.groupId] = 0;
            updateGroupBadge();
            openGroup(g.groupId);
        });
        container.appendChild(el);
    });
}

function openGroup(groupId) {
    const group = myGroups.find(g=>g.groupId===groupId);
    if (!group) return;
    currentGroupId = groupId;
    groupUnread[groupId] = 0;
    updateGroupBadge();
    renderGroupsList();

    groupWelcome.style.display='none';
    groupMessagesEl.style.display='flex';

    const memberStr = group.members.map(m=>`${m.user}@${m.node}`).join(', ');
    groupChatHeader.innerHTML = `
        <span class="chat-header-icon"><i class="fa-solid fa-people-group"></i></span>
        <div class="chat-header-info">
            <h2>${group.name}</h2>
            <p class="subtitle">${group.members.length} members — ${memberStr}</p>
        </div>`;
    groupMessageForm.style.display='flex';
    groupMessagesEl.innerHTML='';

    fetch(`/api/group-messages?groupId=${encodeURIComponent(groupId)}`)
        .then(r=>r.json())
        .then(msgs => { msgs.forEach(m=>appendGroupMessage(m, group)); scrollToBottom(groupMessagesEl); });
    groupMessageText.focus();
}

function appendGroupMessage(msg, group) {
    const isMe = msg.fromUser===myUsername && msg.fromNode===myNodeName;
    const div  = document.createElement('div');
    div.className = 'message ' + (isMe ? 'msg-out' : 'msg-in');
    if (!isMe) {
        const sender = document.createElement('div');
        sender.className = 'msg-sender';
        sender.textContent = msg.fromUser + '@' + msg.fromNode;
        div.appendChild(sender);
    }
    const textDiv = document.createElement('div');
    textDiv.textContent = msg.message;
    div.appendChild(textDiv);
    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    if (msg.timestamp) {
        const d = new Date(msg.timestamp.endsWith('Z') ? msg.timestamp : msg.timestamp+'Z');
        if (!isNaN(d)) meta.textContent = d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    }
    div.appendChild(meta);
    groupMessagesEl.appendChild(div);
}

groupMessageForm.addEventListener('submit', e => {
    e.preventDefault();
    const text = groupMessageText.value.trim();
    if (!text || !currentGroupId) return;
    socket.emit('send_group_message', {groupId: currentGroupId, message: text});
    groupMessageText.value='';
});

socket.on('group_chat_message', data => {
    const group = myGroups.find(g=>g.groupId===data.groupId);
    if (!group) return;

    const isMe              = data.fromUser===myUsername && data.fromNode===myNodeName;
    const isCurrentGroup    = data.groupId === currentGroupId;
    const isViewingGroups   = currentTab === 'groups';

    if (isCurrentGroup && isViewingGroups) {
        appendGroupMessage(data, group);
        scrollToBottom(groupMessagesEl);
    } else if (!isMe) {
        // Unread badge
        groupUnread[data.groupId] = (groupUnread[data.groupId] || 0) + 1;
        updateGroupBadge();
        renderGroupsList();

        const senderLabel = `${data.fromUser} in ${group.name}`;
        showToast({
            type: 'group',
            icon: 'fa-people-group',
            title: senderLabel,
            text: data.message.length > 60 ? data.message.slice(0,60)+'…' : data.message,
            onClick: () => {
                document.querySelector('.rail-btn[data-tab="groups"]').click();
                openGroup(data.groupId);
            }
        });
        sendBrowserNotif(senderLabel, data.message, () => {
            document.querySelector('.rail-btn[data-tab="groups"]').click();
            openGroup(data.groupId);
        });
    }
});

socket.on('groups_list', groups => { myGroups=groups; renderGroupsList(); });
socket.on('group_created', group => {
    if (!myGroups.find(g=>g.groupId===group.groupId)) {
        myGroups.push(group);
        renderGroupsList();
        showToast({ type:'group', icon:'fa-people-group', title:'Group created', text:`You are now in "${group.name}"` });
    }
});

// ═══════════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════════
function loadAdminPanel() {
    // Always reload the active sub-tab
    if (currentAdminTab === 'overview') loadAdminOverview();
    else if (currentAdminTab === 'users') loadAdminUsers();
    else if (currentAdminTab === 'sessions') refreshAdminSessions();
    else if (currentAdminTab === 'logs') refreshAdminLogs();
}

function loadAdminOverview() {
    const headers = {'x-username': myUsername};

    // Stats + config
    fetch('/api/admin/stats', {headers})
        .then(r=>{ if(!r.ok) throw new Error('Forbidden'); return r.json(); })
        .then(d=>{
            document.getElementById('admin-user-count').textContent = d.userCount;
            document.getElementById('admin-msg-count').textContent  = d.messageCount;
            const ls = document.getElementById('admin-cnode-status');
            ls.textContent = (d.cnodeStatus==='Online' ? '● ' : '○ ') + d.cnodeStatus;
            ls.className   = 'value ' + (d.cnodeStatus==='Online' ? 'status-healthy' : 'status-offline');
            document.getElementById('admin-node-name').textContent = d.nodeName;
            document.getElementById('admin-node-type').textContent = d.nodeType;
            document.getElementById('admin-cnode-url').textContent  = d.cnodeUrl;

            // Peer nodes table
            const tbody = document.getElementById('admin-peer-table');
            tbody.innerHTML = '';
            const peers = d.peers || [];
            if (peers.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-3);padding:16px;">No peer nodes</td></tr>';
            } else {
                peers.forEach(n => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `<td><strong>${n}</strong></td><td><span class="badge badge-online"><i class="fa-solid fa-circle" style="font-size:7px;"></i> Online</span></td><td>Direct</td>`;
                    tbody.appendChild(tr);
                });
            }
        })
        .catch(()=>alert('Admin access denied.'));

    // Sessions for uptime + count
    fetch('/api/admin/sessions', {headers})
        .then(r=>r.json())
        .then(d=>{
            document.getElementById('admin-session-count').textContent = d.sessions.length;
            const s = d.uptime;
            const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
            document.getElementById('admin-uptime').textContent =
                (h > 0 ? h+'h ' : '') + (m > 0 ? m+'m ' : '') + sec+'s';
        }).catch(()=>{});
}

function loadAdminUsers() {
    const headers = {'x-username': myUsername};
    fetch('/api/admin/users', {headers}).then(r=>r.json()).then(users=>{
        const grid = document.getElementById('admin-user-cards');
        grid.innerHTML='';
        users.forEach(u=>{
            const isSys  = u.username==='admin';
            const isBanned = u.banned === 1;
            const card = document.createElement('div');
            card.className = 'user-card' + (isBanned ? ' user-card-banned' : '');
            const avatarHtml = u.avatar_url
                ? `<img src="${u.avatar_url}" alt="${u.username}" class="user-card-avatar-img">`
                : `<span class="user-card-avatar-initial">${u.username.charAt(0).toUpperCase()}</span>`;
            card.innerHTML = `
                <div class="user-card-avatar">${avatarHtml}</div>
                <div class="user-card-info">
                    <div class="user-card-name">${u.display_name || u.username}</div>
                    <div class="user-card-handle">@${u.username}</div>
                    <div class="user-card-bio">${u.bio || '<span style="color:var(--text-3)">No bio</span>'}</div>
                </div>
                <div class="user-card-status">
                    ${isBanned ? '<span class="badge-banned">Banned</span>' : '<span class="badge badge-online">Active</span>'}
                </div>
                <div class="user-card-actions">
                    ${isSys ? '<span style="color:var(--text-3);font-size:12px;">System</span>' : `
                        ${isBanned
                            ? `<button class="btn-secondary" style="font-size:12px;padding:4px 10px;" onclick="adminUnban('${u.username}')">Unban</button>`
                            : `<button class="btn-warning-compact" onclick="adminBan('${u.username}')">Ban</button>`}
                        <button class="btn-danger-compact" onclick="deleteUser('${u.username}')">Delete</button>
                    `}
                </div>`;
            grid.appendChild(card);
        });
        if (users.length === 0) grid.innerHTML = '<div class="panel-empty" style="padding:32px;">No users registered.</div>';
    }).catch(()=>{});
}

window.refreshAdminSessions = function() {
    const headers = {'x-username': myUsername};
    fetch('/api/admin/sessions', {headers}).then(r=>r.json()).then(d=>{
        const tbody = document.getElementById('admin-sessions-table');
        tbody.innerHTML='';
        if (d.sessions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-3);padding:20px;">No active sessions</td></tr>';
            return;
        }
        d.sessions.forEach(s => {
            const connectedAt = new Date(s.connectedAt);
            const durationSec = Math.floor((Date.now() - connectedAt.getTime()) / 1000);
            const h = Math.floor(durationSec/3600), m = Math.floor((durationSec%3600)/60), sec = durationSec%60;
            const dur = (h>0?h+'h ':'') + (m>0?m+'m ':'') + sec+'s';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${s.username}</strong></td>
                <td style="font-family:var(--font-mono);font-size:12px;">${connectedAt.toLocaleTimeString()}</td>
                <td>${dur}</td>`;
            tbody.appendChild(tr);
        });
    }).catch(()=>{});
};

window.refreshAdminLogs = function() {
    const headers = {'x-username': myUsername};
    fetch('/api/admin/logs', {headers}).then(r=>r.json()).then(d=>{
        const box = document.getElementById('admin-logs');
        box.textContent = d.logs.join('\n') || 'No logs.';
        box.scrollTop = box.scrollHeight;
    }).catch(()=>{});
};

window.deleteUser = function(username) {
    if (!confirm(`Delete user "${username}"? This is irreversible.`)) return;
    fetch(`/api/admin/user/${username}`, {method:'DELETE', headers:{'x-username':myUsername}})
        .then(r=>r.json())
        .then(d=>{ if(d.status==='ok'){ showToast({type:'error',icon:'fa-trash',title:'User deleted',text:`${username} has been removed.`}); loadAdminUsers(); } else alert('Error: '+d.error); })
        .catch(()=>alert('Network error.'));
};

window.adminBan = function(username) {
    if (!confirm(`Ban "${username}"? They will be kicked and unable to log in.`)) return;
    fetch(`/api/admin/user/${username}/ban`, {method:'POST', headers:{'x-username':myUsername}})
        .then(r=>r.json())
        .then(d=>{ if(d.status==='ok'){ showToast({type:'error',icon:'fa-ban',title:'User banned',text:`${username} has been banned.`}); loadAdminUsers(); } else alert('Error: '+d.error); })
        .catch(()=>alert('Network error.'));
};

window.adminUnban = function(username) {
    fetch(`/api/admin/user/${username}/unban`, {method:'POST', headers:{'x-username':myUsername}})
        .then(r=>r.json())
        .then(d=>{ if(d.status==='ok'){ showToast({type:'group',icon:'fa-circle-check',title:'User unbanned',text:`${username} can now log in again.`}); loadAdminUsers(); } else alert('Error: '+d.error); })
        .catch(()=>alert('Network error.'));
};
