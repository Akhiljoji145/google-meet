console.log("Meeting App Initialized");

// Global State
let localStream;
let peers = {}; // channel_name -> RTCPeerConnection
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const videoGrid = document.getElementById('video-grid');
const participantList = document.getElementById('participant-list');
const participantCount = document.getElementById('participant-count');
const toastContainer = document.getElementById('toast-container');

// ICE Servers for WebRTC
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// WebSocket Connection
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${protocol}//${window.location.host}/ws/meeting/${ROOM_ID}/`;
const socket = new WebSocket(wsUrl);

socket.onopen = () => {
    console.log("WebSocket connected!");
    initLocalVideo();
};

socket.onclose = () => {
    console.log("WebSocket disconnected!");
    showToast("Connection lost!", true);
};

socket.onerror = (e) => {
    console.error("WebSocket error", e);
};

// WebSocket Message Handler
socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    const type = data.type;
    const senderChannel = data.channel_name || data.sender_channel;

    if (type === 'chat_message') {
        appendChatMessage(data.username, data.message);
    } 
    else if (type === 'new_peer') {
        console.log("New peer joined:", data.username);
        addParticipant(data.username);
        // Create an offer for the new peer
        const peer = createPeerConnection(senderChannel, data.username);
        peers[senderChannel] = peer;
        
        try {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            socket.send(JSON.stringify({
                type: 'offer',
                data: offer,
                target: senderChannel
            }));
        } catch (e) {
            console.error("Error creating offer:", e);
        }
    }
    else if (type === 'peer_left') {
        console.log("Peer left:", data.username);
        removeParticipant(data.username);
        if (peers[senderChannel]) {
            peers[senderChannel].close();
            delete peers[senderChannel];
        }
        const videoEl = document.getElementById(`video-${senderChannel}`);
        if (videoEl) videoEl.remove();
    }
    else if (type === 'offer') {
        addParticipant(data.username);
        const peer = createPeerConnection(senderChannel, data.username);
        peers[senderChannel] = peer;
        
        try {
            await peer.setRemoteDescription(new RTCSessionDescription(data.data));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            socket.send(JSON.stringify({
                type: 'answer',
                data: answer,
                target: senderChannel
            }));
        } catch (e) {
            console.error("Error handling offer:", e);
        }
    }
    else if (type === 'answer') {
        const peer = peers[senderChannel];
        if (peer) {
            try {
                await peer.setRemoteDescription(new RTCSessionDescription(data.data));
            } catch (e) {
                console.error("Error setting remote description:", e);
            }
        }
    }
    else if (type === 'ice_candidate') {
        const peer = peers[senderChannel];
        if (peer) {
            try {
                await peer.addIceCandidate(new RTCIceCandidate(data.data));
            } catch (e) {
                console.error("Error adding ice candidate:", e);
            }
        }
    }
    else if (type === 'user_status') {
        updateParticipantStatus(data.username, data.status);
    }
};

// WebRTC Initialization
async function initLocalVideo() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localVideo = document.getElementById('local-video');
        localVideo.srcObject = localStream;
    } catch (error) {
        console.error("Error accessing media devices.", error);
        showToast("Cannot access camera/microphone");
    }
}

function createPeerConnection(channelName, username) {
    const peer = new RTCPeerConnection(rtcConfig);
    
    // Add local tracks
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peer.addTrack(track, localStream);
        });
    }

    // Handle ICE Candidates
    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: 'ice_candidate',
                data: event.candidate,
                target: channelName
            }));
        }
    };

    // Handle remote stream
    peer.ontrack = (event) => {
        let videoContainer = document.getElementById(`video-${channelName}`);
        if (!videoContainer) {
            videoContainer = document.createElement('div');
            videoContainer.id = `video-${channelName}`;
            videoContainer.className = 'video-container';
            
            const videoElement = document.createElement('video');
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoElement.srcObject = event.streams[0];
            
            const label = document.createElement('div');
            label.className = 'video-label';
            label.innerText = username;
            
            videoContainer.appendChild(videoElement);
            videoContainer.appendChild(label);
            videoGrid.appendChild(videoContainer);
        }
    };

    return peer;
}

// Controls
document.getElementById('btn-toggle-mic').addEventListener('click', (e) => {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            e.target.classList.toggle('active', !audioTrack.enabled);
            e.target.innerText = audioTrack.enabled ? '🎤' : '🔇';
        }
    }
});

document.getElementById('btn-toggle-cam').addEventListener('click', (e) => {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            e.target.classList.toggle('active', !videoTrack.enabled);
            e.target.innerText = videoTrack.enabled ? '📷' : '🚫';
        }
    }
});

// Chat
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && chatInput.value.trim() !== '') {
        const message = chatInput.value.trim();
        socket.send(JSON.stringify({
            type: 'chat_message',
            message: message
        }));
        chatInput.value = '';
    }
});

function appendChatMessage(username, message) {
    const el = document.createElement('div');
    el.style.marginBottom = '8px';
    el.innerHTML = `<strong>${username}:</strong> ${message}`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Participant UI
function addParticipant(username) {
    if (!document.getElementById(`participant-${username}`)) {
        const el = document.createElement('div');
        el.className = 'participant-item';
        el.id = `participant-${username}`;
        el.innerHTML = `
            <div>
                <span class="status-indicator status-active"></span>
                ${username}
            </div>
        `;
        participantList.appendChild(el);
        updateParticipantCount();
    }
}

function removeParticipant(username) {
    const el = document.getElementById(`participant-${username}`);
    if (el) {
        el.remove();
        updateParticipantCount();
    }
}

function updateParticipantCount() {
    const count = document.querySelectorAll('.participant-item').length;
    participantCount.innerText = count;
}

// --- ATTENTION TRACKING SYSTEM ---
let idleTimer;
const IDLE_TIMEOUT = 30000; // 30 seconds
let isCurrentlyInactive = false;

function sendStatus(status) {
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'user_status',
            status: status
        }));
    }
}

// 1. Tab Visibility Change
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        isCurrentlyInactive = true;
        sendStatus('inactive');
    } else {
        isCurrentlyInactive = false;
        sendStatus('active');
        resetIdleTimer();
    }
});

// 2. Idle Detection
function resetIdleTimer() {
    if (isCurrentlyInactive) return; // Don't reset if tab is hidden
    
    clearTimeout(idleTimer);
    
    // If returning from idle
    if (isCurrentlyInactive) {
        isCurrentlyInactive = false;
        sendStatus('active');
    }
    
    idleTimer = setTimeout(() => {
        isCurrentlyInactive = true;
        sendStatus('inactive');
    }, IDLE_TIMEOUT);
}

// Listen for activity to reset idle timer
['mousemove', 'mousedown', 'keypress', 'touchmove'].forEach(evt => {
    document.addEventListener(evt, resetIdleTimer, { passive: true });
});

// Start idle timer initially
resetIdleTimer();

// Update status in UI
function updateParticipantStatus(username, status) {
    const el = document.getElementById(`participant-${username}`);
    if (el) {
        const indicator = el.querySelector('.status-indicator');
        if (status === 'inactive') {
            indicator.className = 'status-indicator status-inactive';
            if (IS_HOST) showToast(`Student ${username} is inactive/switched tabs`);
        } else {
            indicator.className = 'status-indicator status-active';
            if (IS_HOST) showToast(`Student ${username} is active`);
        }
    }
}

// Toasts
function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast show';
    if (isError) toast.style.background = 'var(--danger-color)';
    else toast.style.background = 'var(--accent-color)';
    toast.innerText = message;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}
