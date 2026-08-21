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

// ── Auto-restore session from cookie ─────────────────────────────────────
fetch('/api/me')
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(d => {
        myUsername = d.username;
        myNodeName = d.nodeName;
        document.querySelectorAll('.node-name-label').forEach(el => el.textContent = myNodeName);
        socket.emit('login', myUsername);
        initApp();
    })
    .catch(() => { /* No saved session — show login screen normally */ });

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

// ── Logout ────────────────────────────────────────────────────────────────
function logout() {
    fetch('/api/logout', { method: 'POST' }).finally(() => {
        socket.disconnect();
        location.reload();
    });
}

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
            <h2><button class="profile-name-btn" onclick="openProfile('${tUser}','${tNode}')">${tUser}</button></h2>
            <p class="subtitle">@${tNode}</p>
        </div>
        <div class="chat-header-actions">
            <button class="call-icon-btn" title="Voice call" onclick="CallManager.startCall('${tUser}','${tNode}',false)">
                <i class="fa-solid fa-phone"></i>
            </button>
            <button class="call-icon-btn" title="Video call" onclick="CallManager.startCall('${tUser}','${tNode}',true)">
                <i class="fa-solid fa-video"></i>
            </button>
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
        el.style.cssText = 'position:relative;';
        el.innerHTML = `
            <div class="si-avatar" style="cursor:pointer;" title="View profile" onclick="event.stopPropagation();openProfile('${user}','${node}')">${user.charAt(0).toUpperCase()}</div>
            <div class="si-info">
                <span class="si-name"><button class="profile-name-btn" onclick="event.stopPropagation();openProfile('${user}','${node}')">${user}</button></span>
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
        </div>
        <div class="chat-header-actions">
            <button class="call-icon-btn" title="Start group call" onclick="CallManager.startGroupCall('${groupId}')">
                <i class="fa-solid fa-video"></i>
            </button>
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

// ═══════════════════════════════════════════════════════
// PROFILE VIEWER
// ═══════════════════════════════════════════════════════
function openProfile(username, nodeName) {
    const modal        = document.getElementById('profile-modal');
    const avatarImg    = document.getElementById('pm-avatar-img');
    const avatarInit   = document.getElementById('pm-avatar-initial');
    const displayname  = document.getElementById('pm-displayname');
    const handle       = document.getElementById('pm-handle');
    const bio          = document.getElementById('pm-bio');
    const nodeEl       = document.getElementById('pm-node');
    const actions      = document.getElementById('pm-actions');

    // Reset state
    avatarImg.style.display  = 'none';
    avatarImg.src            = '';
    avatarInit.style.display = 'block';
    avatarInit.textContent   = username.charAt(0).toUpperCase();
    displayname.textContent  = username;
    handle.textContent       = '@' + username;
    bio.textContent          = 'No bio provided.';
    nodeEl.textContent       = '@' + nodeName;
    actions.innerHTML        = '';

    modal.style.display = 'flex';
    document.addEventListener('keydown', profileEscListener);

    // Add buttons if it's not ourselves
    if (username !== myUsername || nodeName !== myNodeName) {
        const msgBtn = document.createElement('button');
        msgBtn.className = 'btn-primary';
        msgBtn.innerHTML = '<i class="fa-solid fa-message" style="margin-right:6px;"></i>Message';
        msgBtn.onclick = () => {
            closeProfileModal();
            const msgRailBtn = document.querySelector('.rail-btn[data-tab="messages"]');
            if (msgRailBtn) msgRailBtn.click();
            startChat(username, nodeName);
        };
        actions.appendChild(msgBtn);

        const callBtn = document.createElement('button');
        callBtn.className = 'btn-secondary';
        callBtn.innerHTML = '<i class="fa-solid fa-phone" style="margin-right:6px;"></i>Call';
        callBtn.onclick = () => {
            closeProfileModal();
            CallManager.startCall(username, nodeName, false);
        };
        actions.appendChild(callBtn);

        const vidBtn = document.createElement('button');
        vidBtn.className = 'btn-secondary';
        vidBtn.innerHTML = '<i class="fa-solid fa-video" style="margin-right:6px;"></i>Video';
        vidBtn.onclick = () => {
            closeProfileModal();
            CallManager.startCall(username, nodeName, true);
        };
        actions.appendChild(vidBtn);
    }

    // Fetch full profile if this user is on the same node
    if (nodeName === myNodeName) {
        fetch(`/api/profile/${encodeURIComponent(username)}`, {
            headers: { 'x-username': myUsername }
        }).then(r => r.ok ? r.json() : null).then(p => {
            if (!p) return;
            displayname.textContent = p.display_name || username;
            handle.textContent      = '@' + p.username;
            bio.textContent         = p.bio || 'No bio provided.';
            if (p.avatar_url) {
                avatarImg.src            = p.avatar_url;
                avatarImg.style.display  = 'block';
                avatarInit.style.display = 'none';
            }
        }).catch(() => {});
    }
}

function profileEscListener(e) {
    if (e.key === 'Escape') closeProfileModal();
}

function closeProfileModal() {
    document.getElementById('profile-modal').style.display = 'none';
    document.removeEventListener('keydown', profileEscListener);
}

// Expose globally so HTML onclick attributes can call them
window.openProfile      = openProfile;
window.closeProfileModal = closeProfileModal;

// ═══════════════════════════════════════════════════════
// CALL MANAGER — WebRTC voice + video calling
// ═══════════════════════════════════════════════════════

const STUN_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const CallManager = (() => {
    // ── State ────────────────────────────────────────────
    let state          = 'idle';   // idle | calling | ringing | in-call
    let callId         = null;
    let localStream    = null;
    let isVideo        = true;
    let isMuted        = false;
    let isCamOff       = false;
    let callTimerInterval = null;
    let callStartTime  = null;
    let pendingIncoming = null;   // stored incoming_call payload while ringing
    let isGroupCall     = false;
    let groupCallId     = null;

    // peerConnections: Map<"user@node", RTCPeerConnection>
    const peerConnections = new Map();
    // remoteVideos: Map<"user@node", HTMLVideoElement>
    const remoteVideos = new Map();

    // ── DOM references ───────────────────────────────────
    const incomingOverlay  = () => document.getElementById('incoming-call-overlay');
    const activeOverlay    = () => document.getElementById('active-call-overlay');
    const localVideoEl     = () => document.getElementById('local-video');
    const callVideoArea    = () => document.getElementById('call-video-area');
    const callWithLabel    = () => document.getElementById('call-with-label');
    const callTimerEl      = () => document.getElementById('call-timer');
    const callParticipants = () => document.getElementById('call-participants');

    // ── Helpers ──────────────────────────────────────────
    function genCallId() {
        return crypto.randomUUID();
    }

    function peerId(user, node) {
        return `${user}@${node}`;
    }

    function startTimer() {
        callStartTime = Date.now();
        callTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
            const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const s = String(elapsed % 60).padStart(2, '0');
            const el = callTimerEl();
            if (el) el.textContent = `${m}:${s}`;
        }, 1000);
    }

    function stopTimer() {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }

    function showActiveCall(label) {
        callWithLabel().textContent = label;
        callTimerEl().textContent = '00:00';
        activeOverlay().style.display = 'flex';
        startTimer();
    }

    function hideActiveCall() {
        activeOverlay().style.display = 'none';
        stopTimer();
        callVideoArea().innerHTML = '';
        remoteVideos.clear();
        callParticipants().innerHTML = '';
    }

    function showIncomingCall(data) {
        pendingIncoming = data;
        document.getElementById('ic-avatar').textContent = data.fromUser.charAt(0).toUpperCase();
        document.getElementById('ic-name').textContent   = data.fromUser + '@' + data.fromNode;
        document.getElementById('ic-sub').textContent    = data.isVideo ? 'Incoming video call…' : 'Incoming voice call…';
        incomingOverlay().style.display = 'flex';
        // Play ring using Web Audio API
        startRingTone();
    }

    function hideIncomingCall() {
        incomingOverlay().style.display = 'none';
        stopRingTone();
        pendingIncoming = null;
    }

    // ── Ring tone (Web Audio) ────────────────────────────
    let ringCtx = null;
    let ringInterval = null;

    function startRingTone() {
        try {
            ringCtx = new (window.AudioContext || window.webkitAudioContext)();
            function beep() {
                const osc  = ringCtx.createOscillator();
                const gain = ringCtx.createGain();
                osc.connect(gain);
                gain.connect(ringCtx.destination);
                osc.type = 'sine';
                osc.frequency.value = 440;
                gain.gain.setValueAtTime(0.15, ringCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ringCtx.currentTime + 0.5);
                osc.start();
                osc.stop(ringCtx.currentTime + 0.5);
            }
            beep();
            ringInterval = setInterval(beep, 1500);
        } catch (e) { /* audio not available */ }
    }

    function stopRingTone() {
        clearInterval(ringInterval);
        ringInterval = null;
        if (ringCtx) { ringCtx.close().catch(() => {}); ringCtx = null; }
    }

    // ── Get local media ──────────────────────────────────
    async function getLocalStream(video = true) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
            localVideoEl().srcObject = localStream;
            isVideo = video;
            return localStream;
        } catch (e) {
            // Fallback: audio only
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                localVideoEl().srcObject = localStream;
                isVideo = false;
                return localStream;
            } catch (e2) {
                showToast({ type: 'error', icon: 'fa-microphone-slash', title: 'Media error', text: 'Could not access microphone or camera.' });
                return null;
            }
        }
    }

    function stopLocalStream() {
        if (localStream) {
            localStream.getTracks().forEach(t => t.stop());
            localStream = null;
        }
        const lv = localVideoEl();
        if (lv) lv.srcObject = null;
    }

    // ── Peer connection factory ──────────────────────────
    function createPeerConnection(pid, toUser, toNode) {
        const pc = new RTCPeerConnection(STUN_CONFIG);
        peerConnections.set(pid, pc);

        // Add local tracks
        if (localStream) {
            localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        }

        // ICE candidates → relay via server
        pc.onicecandidate = ({ candidate }) => {
            if (!candidate) return;
            if (isGroupCall) {
                socket.emit('group_call_signal', {
                    type: 'ice', callId: groupCallId,
                    toUser, toNode, candidate
                });
            } else {
                socket.emit('call_ice', { toUser, toNode, candidate, callId });
            }
        };

        // Remote track → create or update video element
        pc.ontrack = ({ streams: [remoteStream] }) => {
            let videoEl = remoteVideos.get(pid);
            if (!videoEl) {
                videoEl = document.createElement('video');
                videoEl.autoplay = true;
                videoEl.playsinline = true;
                videoEl.className = 'remote-video';
                videoEl.dataset.peer = pid;
                callVideoArea().appendChild(videoEl);
                remoteVideos.set(pid, videoEl);
            }
            videoEl.srcObject = remoteStream;
        };

        pc.onconnectionstatechange = () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
                showToast({ type: 'error', icon: 'fa-phone-slash', title: 'Connection lost', text: `Peer ${pid} dropped.` });
                removeRemoteVideo(pid);
                pc.close();
                peerConnections.delete(pid);
                if (peerConnections.size === 0) cleanup();
            }
        };

        return pc;
    }

    function removeRemoteVideo(pid) {
        const el = remoteVideos.get(pid);
        if (el) { el.remove(); remoteVideos.delete(pid); }
    }

    // ── Cleanup ──────────────────────────────────────────
    function cleanup() {
        peerConnections.forEach(pc => pc.close());
        peerConnections.clear();
        stopLocalStream();
        hideActiveCall();
        state       = 'idle';
        callId      = null;
        isGroupCall = false;
        groupCallId = null;
        isMuted     = false;
        isCamOff    = false;
        // Reset control icons & labels
        const mi = document.getElementById('ctrl-mic-icon');
        const ci = document.getElementById('ctrl-cam-icon');
        const ml = document.getElementById('ctrl-mic-label');
        const cl = document.getElementById('ctrl-cam-label');
        if (mi) { mi.className = 'fa-solid fa-microphone'; mi.closest('button').classList.remove('ctrl-active'); }
        if (ci) { ci.className = 'fa-solid fa-video';      ci.closest('button').classList.remove('ctrl-active'); }
        if (ml) ml.textContent = 'Mute';
        if (cl) cl.textContent = 'Camera';
    }

    // ── Start a DM call (outgoing) ───────────────────────
    async function startCall(toUser, toNode, video = true) {
        if (state !== 'idle') {
            showToast({ type: 'error', icon: 'fa-phone', title: 'Already in a call', text: 'End the current call first.' });
            return;
        }
        state  = 'calling';
        callId = genCallId();
        isGroupCall = false;

        const stream = await getLocalStream(video);
        if (!stream) { state = 'idle'; return; }

        const pid = peerId(toUser, toNode);
        const pc  = createPeerConnection(pid, toUser, toNode);

        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: video });
        await pc.setLocalDescription(offer);

        socket.emit('call_user', { toUser, toNode, offer, callId, isVideo: video });

        showActiveCall(`${toUser}@${toNode}`);
        showToast({ type: 'dm', icon: 'fa-phone', title: 'Calling…', text: `Waiting for ${toUser}@${toNode}` });
    }

    // ── Start a group call ───────────────────────────────
    async function startGroupCall(groupId) {
        if (state !== 'idle') {
            showToast({ type: 'error', icon: 'fa-phone', title: 'Already in a call', text: 'End the current call first.' });
            return;
        }
        const group = myGroups.find(g => g.groupId === groupId);
        if (!group) return;

        state       = 'in-call';
        isGroupCall = true;
        groupCallId = genCallId();

        const stream = await getLocalStream(true);
        if (!stream) { state = 'idle'; return; }

        // Announce call start to all members
        socket.emit('group_call_signal', {
            type: 'call_start', callId: groupCallId, groupId,
            fromUser: myUsername, fromNode: myNodeName
        });

        showActiveCall(group.name);
        callWithLabel().textContent = group.name;

        // Send offers to all other members who are not us
        for (const member of group.members) {
            if (member.user === myUsername && member.node === myNodeName) continue;
            const pid = peerId(member.user, member.node);
            const pc  = createPeerConnection(pid, member.user, member.node);
            const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
            await pc.setLocalDescription(offer);
            socket.emit('group_call_signal', {
                type: 'offer', callId: groupCallId, groupId,
                toUser: member.user, toNode: member.node, offer
            });
        }
    }

    // ── Handle incoming call ─────────────────────────────
    function handleIncomingCall(data) {
        if (state !== 'idle') {
            // Auto-reject if busy
            socket.emit('call_reject', { toUser: data.fromUser, toNode: data.fromNode, callId: data.callId });
            return;
        }
        state = 'ringing';
        showIncomingCall(data);
        sendBrowserNotif(
            `${data.fromUser}@${data.fromNode}`,
            data.isVideo ? 'Incoming video call' : 'Incoming voice call',
            () => {}
        );
    }

    // ── Accept call ──────────────────────────────────────
    async function acceptCall() {
        const data = pendingIncoming;
        if (!data) return;
        hideIncomingCall();
        state  = 'in-call';
        callId = data.callId;

        const stream = await getLocalStream(data.isVideo);
        if (!stream) { state = 'idle'; return; }

        const pid = peerId(data.fromUser, data.fromNode);
        const pc  = createPeerConnection(pid, data.fromUser, data.fromNode);

        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('call_answer', {
            toUser: data.fromUser,
            toNode: data.fromNode,
            answer,
            callId: data.callId
        });

        showActiveCall(`${data.fromUser}@${data.fromNode}`);
    }

    // ── Hang up ──────────────────────────────────────────
    function hangUp() {
        if (state === 'ringing') {
            // Reject the pending call
            const data = pendingIncoming;
            if (data) socket.emit('call_reject', { toUser: data.fromUser, toNode: data.fromNode, callId: data.callId });
            hideIncomingCall();
            state = 'idle';
            return;
        }
        if (state === 'idle') return;

        // Notify all remote peers
        peerConnections.forEach((_, pid) => {
            const [toUser, toNode] = pid.split('@');
            if (isGroupCall) {
                socket.emit('group_call_signal', { type: 'hangup', callId: groupCallId, toUser, toNode });
            } else {
                socket.emit('call_hangup', { toUser, toNode, callId });
            }
        });
        cleanup();
    }

    // ── Controls ─────────────────────────────────────────
    function toggleMic() {
        if (!localStream) return;
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
        const icon = document.getElementById('ctrl-mic-icon');
        const btn  = document.getElementById('ctrl-mic');
        const label = document.getElementById('ctrl-mic-label');
        if (isMuted) {
            icon.className = 'fa-solid fa-microphone-slash';
            btn.classList.add('ctrl-active');
            btn.title = 'Unmute microphone';
            if (label) label.textContent = 'Unmute';
        } else {
            icon.className = 'fa-solid fa-microphone';
            btn.classList.remove('ctrl-active');
            btn.title = 'Mute microphone';
            if (label) label.textContent = 'Mute';
        }
    }

    function toggleCamera() {
        if (!localStream) return;
        isCamOff = !isCamOff;
        localStream.getVideoTracks().forEach(t => t.enabled = !isCamOff);
        const icon = document.getElementById('ctrl-cam-icon');
        const btn  = document.getElementById('ctrl-cam');
        const label = document.getElementById('ctrl-cam-label');
        if (isCamOff) {
            icon.className = 'fa-solid fa-video-slash';
            btn.classList.add('ctrl-active');
            btn.title = 'Turn camera on';
            if (label) label.textContent = 'Cam Off';
        } else {
            icon.className = 'fa-solid fa-video';
            btn.classList.remove('ctrl-active');
            btn.title = 'Turn camera off';
            if (label) label.textContent = 'Camera';
        }
    }

    // ── Socket.IO incoming events ────────────────────────
    socket.on('incoming_call', (data) => {
        handleIncomingCall({ ...data, isGroupCall: false });
    });

    socket.on('call_answered', async (data) => {
        const pid = peerId(data.fromUser, data.fromNode);
        const pc  = peerConnections.get(pid);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        state = 'in-call';
    });

    socket.on('call_rejected', (data) => {
        showToast({ type: 'error', icon: 'fa-phone-slash', title: 'Call declined', text: `${data.fromUser}@${data.fromNode} declined.` });
        cleanup();
    });

    socket.on('call_ended', (data) => {
        showToast({ type: 'dm', icon: 'fa-phone-slash', title: 'Call ended', text: `${data.fromUser}@${data.fromNode} hung up.` });
        cleanup();
    });

    socket.on('call_ice', async (data) => {
        if (!data.candidate) return;
        const pid = peerId(data.fromUser, data.fromNode);
        const pc  = peerConnections.get(pid);
        if (pc) {
            try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
        }
    });

    socket.on('call_error', (data) => {
        showToast({ type: 'error', icon: 'fa-phone-slash', title: 'Call failed', text: data.error });
        cleanup();
    });

    // Group call signalling
    socket.on('group_call_signal', async (data) => {
        const pid = peerId(data.fromUser, data.fromNode);

        if (data.type === 'call_start') {
            // Someone in the group started a call
            if (state !== 'idle') return;
            const group = myGroups.find(g => g.groupId === data.groupId);
            if (!group) return;
            handleIncomingCall({
                fromUser: data.fromUser,
                fromNode: data.fromNode,
                callId: data.callId,
                isVideo: true,
                isGroupCall: true,
                groupId: data.groupId
            });
        } else if (data.type === 'offer') {
            // A specific offer for us from a group peer
            if (state === 'ringing' || state === 'idle') {
                // Auto-join if we started the call ourselves or accepted
                // If we're in state 'in-call' we process normally
                // If idle, this is a late offer — ignore for now
                if (state === 'idle') return;
            }
            if (!localStream) {
                localStream = await getLocalStream(true);
                if (!localStream) return;
            }
            const pc = createPeerConnection(pid, data.fromUser, data.fromNode);
            groupCallId = data.callId;
            isGroupCall = true;
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('group_call_signal', {
                type: 'answer', callId: data.callId,
                toUser: data.fromUser, toNode: data.fromNode, answer
            });
            if (state !== 'in-call') { state = 'in-call'; showActiveCall(data.fromUser + '@' + data.fromNode); }
        } else if (data.type === 'answer') {
            const pc = peerConnections.get(pid);
            if (pc) await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.type === 'ice') {
            const pc = peerConnections.get(pid);
            if (pc && data.candidate) {
                try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
            }
        } else if (data.type === 'hangup') {
            removeRemoteVideo(pid);
            const pc = peerConnections.get(pid);
            if (pc) { pc.close(); peerConnections.delete(pid); }
            if (peerConnections.size === 0) cleanup();
        }
    });

    // ── Incoming call button handlers ────────────────────
    document.getElementById('ic-accept-btn').addEventListener('click', acceptCall);
    document.getElementById('ic-reject-btn').addEventListener('click', () => {
        const data = pendingIncoming;
        if (data) socket.emit('call_reject', { toUser: data.fromUser, toNode: data.fromNode, callId: data.callId });
        hideIncomingCall();
        state = 'idle';
    });

    // ── Public API ───────────────────────────────────────
    return { startCall, startGroupCall, hangUp, toggleMic, toggleCamera };
})();

window.CallManager = CallManager;
