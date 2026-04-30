console.log("Meeting Room Initialized");

let localStream = null;
const peers = {};

const mediaStateKey = `signalroom-prejoin:${ROOM_ID}`;

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const videoGrid = document.getElementById('video-grid');
const participantList = document.getElementById('participant-list');
const participantCount = document.getElementById('participant-count');
const toastContainer = document.getElementById('toast-container');
const localVideo = document.getElementById('local-video');
const enableMediaButton = document.getElementById('btn-enable-media');
const micButton = document.getElementById('btn-toggle-mic');
const camButton = document.getElementById('btn-toggle-cam');

const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const supportsMediaDevices = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const hasSecureMediaContext = window.isSecureContext || isLocalhost;

const mediaState = loadMediaState();

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

let pollInterval;
let lastMessageId = 0;
let knownParticipants = new Set();
knownParticipants.add(USERNAME);

async function sendSignal(type, data = null, target = null) {
    const payload = {
        type: type,
        payload: data,
        target: target
    };
    try {
        await fetch(SEND_SIGNAL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error("Error sending signal:", e);
    }
}

async function initializeRoom() {
    if (mediaState.requested) {
        await requestLocalMedia({ showSuccess: false });
    } else {
        localStream = new MediaStream();
        localVideo.srcObject = localStream;
    }

    updateParticipantCount();
    updateMediaButtons();
    sendStatus('active');
    
    sendSignal('new_peer');

    pollInterval = setInterval(pollSignals, 1500);
}

async function pollSignals() {
    try {
        const response = await fetch(`${POLL_SIGNALS_URL}?last_id=${lastMessageId}`);
        const data = await response.json();
        
        lastMessageId = data.last_id;
        
        const currentUsers = new Set(data.active_users);
        
        for (const user of currentUsers) {
            if (!knownParticipants.has(user)) {
                knownParticipants.add(user);
                addParticipant(user);
            }
        }
        
        for (const user of knownParticipants) {
            if (!currentUsers.has(user) && user !== USERNAME) {
                knownParticipants.delete(user);
                handlePeerLeft(user);
            }
        }

        for (const msg of data.messages) {
            await handleSignalMessage(msg);
        }
    } catch (e) {
        console.error("Error polling:", e);
    }
}

function handlePeerLeft(username) {
    removeParticipant(username);
    for (const [channelName, peer] of Object.entries(peers)) {
        if (peer.username === username) {
            peer.close();
            delete peers[channelName];
            removePeerVideo(channelName);
            break;
        }
    }
}

async function handleSignalMessage(data) {
    const type = data.type;
    const senderChannel = data.sender;

    if (type === 'chat_message') {
        appendChatMessage(data.sender, data.payload);
    } else if (type === 'new_peer') {
        addParticipant(data.sender);
        const peer = getOrCreatePeerConnection(senderChannel, data.sender);

        try {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            sendSignal('offer', offer, senderChannel);
        } catch (error) {
            console.error("Error creating offer:", error);
        }
    } else if (type === 'peer_left') {
        handlePeerLeft(data.sender);
    } else if (type === 'offer') {
        addParticipant(data.sender);
        const peer = getOrCreatePeerConnection(senderChannel, data.sender);

        try {
            await peer.setRemoteDescription(new RTCSessionDescription(data.payload));
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            sendSignal('answer', answer, senderChannel);
        } catch (error) {
            console.error("Error handling offer:", error);
        }
    } else if (type === 'answer') {
        const peer = peers[senderChannel];
        if (peer) {
            try {
                await peer.setRemoteDescription(new RTCSessionDescription(data.payload));
            } catch (error) {
                console.error("Error setting remote description:", error);
            }
        }
    } else if (type === 'ice_candidate') {
        const peer = peers[senderChannel];
        if (peer) {
            try {
                await peer.addIceCandidate(new RTCIceCandidate(data.payload));
            } catch (error) {
                console.error("Error adding ice candidate:", error);
            }
        }
    } else if (type === 'user_status') {
        updateParticipantStatus(data.sender, data.payload);
    }
}

function loadMediaState() {
    try {
        const raw = sessionStorage.getItem(mediaStateKey);
        if (!raw) {
            return {
                requested: false,
                audioEnabled: true,
                videoEnabled: true
            };
        }

        const parsed = JSON.parse(raw);
        return {
            requested: Boolean(parsed.requested),
            audioEnabled: parsed.audioEnabled !== false,
            videoEnabled: parsed.videoEnabled !== false
        };
    } catch (error) {
        return {
            requested: false,
            audioEnabled: true,
            videoEnabled: true
        };
    }
}

function saveMediaState() {
    sessionStorage.setItem(mediaStateKey, JSON.stringify(mediaState));
}

async function requestLocalMedia(options = {}) {
    if (!supportsMediaDevices) {
        showToast("Browser media access is not supported.", true);
        return;
    }

    if (!hasSecureMediaContext) {
        showToast("Open the site on HTTPS to use camera and microphone.", true);
        return;
    }

    enableMediaButton.disabled = true;
    enableMediaButton.textContent = "Connecting...";

    try {
        const constraints = {
            video: mediaState.videoEnabled,
            audio: mediaState.audioEnabled
        };

        stopLocalTracks();
        
        if (constraints.video || constraints.audio) {
            localStream = await navigator.mediaDevices.getUserMedia(constraints);
        } else {
            localStream = new MediaStream();
        }
        localVideo.srcObject = localStream;

        mediaState.requested = true;
        updateMediaButtons();
        saveMediaState();
        mediaState.requested = true;
        updateMediaButtons();
        saveMediaState();
        await syncLocalTracksToPeers();

        if (options.showSuccess !== false && (constraints.video || constraints.audio)) {
            showToast("Camera and microphone enabled.");
        }
    } catch (error) {
        console.error("Error accessing media devices.", error);
        handleMediaError(error);
    } finally {
        enableMediaButton.disabled = false;
        updateMediaButtons();
    }
}

function stopLocalTracks() {
    if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
    }
}

// applySavedTrackState removed

function getOrCreatePeerConnection(channelName, username) {
    if (peers[channelName]) {
        return peers[channelName];
    }

    const peer = createPeerConnection(channelName, username);
    peers[channelName] = peer;
    return peer;
}

function createPeerConnection(channelName, username) {
    const peer = new RTCPeerConnection(rtcConfig);

    peer.username = username;

    attachLocalTracks(peer);

    peer.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal('ice_candidate', event.candidate, channelName);
        }
    };

    peer.oniceconnectionstatechange = () => {
        console.log(`ICE Connection State for ${channelName}: ${peer.iceConnectionState}`);
        if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'disconnected') {
            showToast(`Connection to ${username} failed. Network firewall might be blocking it.`, true);
        }
    };

    peer.ontrack = (event) => {
        let videoContainer = document.getElementById(`video-${channelName}`);
        if (!videoContainer) {
            videoContainer = document.createElement('div');
            videoContainer.id = `video-${channelName}`;
            videoContainer.className = 'video-container';

            const videoElement = document.createElement('video');
            videoElement.playsInline = true;
            videoElement.srcObject = event.streams[0];
            
            videoElement.onloadedmetadata = () => {
                videoElement.play().catch(e => {
                    console.error("Autoplay blocked:", e);
                    showToast("Click anywhere on the screen to allow video to play.", true);
                });
            };

            const label = document.createElement('div');
            label.className = 'video-label';
            label.textContent = username;

            videoContainer.appendChild(videoElement);
            videoContainer.appendChild(label);
            videoGrid.appendChild(videoContainer);
        }
    };

    return peer;
}

function attachLocalTracks(peer) {
    if (!localStream) {
        return false;
    }

    let addedTrack = false;

    localStream.getTracks().forEach((track) => {
        const sender = peer.getSenders().find((currentSender) => (
            currentSender.track && currentSender.track.kind === track.kind
        ));

        if (sender) {
            sender.replaceTrack(track);
        } else {
            peer.addTrack(track, localStream);
            addedTrack = true;
        }
    });

    return addedTrack;
}

async function syncLocalTracksToPeers() {
    const peerEntries = Object.entries(peers);

    for (const [channelName, peer] of peerEntries) {
        const addedTrack = attachLocalTracks(peer);
        if (addedTrack) {
            await renegotiatePeer(channelName, peer);
        }
    }
}

async function renegotiatePeer(channelName, peer) {
    if (peer.signalingState !== 'stable') {
        return;
    }

    try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        sendSignal('offer', offer, channelName);
    } catch (error) {
        console.error("Error renegotiating peer connection:", error);
    }
}

function updateMediaButtons() {
    const audioTrack = localStream ? localStream.getAudioTracks()[0] : null;
    const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;
    
    const hasActiveAudio = audioTrack && audioTrack.readyState !== 'ended';
    const hasActiveVideo = videoTrack && videoTrack.readyState !== 'ended';
    
    const hasMedia = hasActiveAudio || hasActiveVideo;

    enableMediaButton.textContent = hasMedia ? "Reconnect media" : "Enable media";
    
    micButton.disabled = false;
    camButton.disabled = false;

    micButton.classList.toggle('active', !hasActiveAudio);
    camButton.classList.toggle('active', !hasActiveVideo);

    micButton.textContent = hasActiveAudio ? 'Mic on' : 'Mic off';
    camButton.textContent = hasActiveVideo ? 'Cam on' : 'Cam off';
}

function handleMediaError(error) {
    const permissionDenied = ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
    const deviceMissing = ['NotFoundError', 'DevicesNotFoundError'].includes(error.name);
    const deviceBusy = ['NotReadableError', 'TrackStartError'].includes(error.name);

    if (permissionDenied) {
        showToast("Camera or microphone permission was blocked.", true);
        return;
    }

    if (deviceMissing) {
        showToast("No camera or microphone device was found.", true);
        return;
    }

    if (deviceBusy) {
        showToast("Camera or microphone is busy in another app.", true);
        return;
    }

    showToast("Cannot access camera or microphone.", true);
}

enableMediaButton.addEventListener('click', async () => {
    mediaState.requested = true;
    if (!mediaState.audioEnabled && !mediaState.videoEnabled) {
        mediaState.audioEnabled = true;
        mediaState.videoEnabled = true;
    }
    saveMediaState();
    await requestLocalMedia();
});

micButton.addEventListener('click', async () => {
    let audioTrack = localStream ? localStream.getAudioTracks()[0] : null;

    if (!audioTrack || audioTrack.readyState === 'ended') {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const newAudioTrack = newStream.getAudioTracks()[0];
            
            if (!localStream) {
                localStream = new MediaStream();
                localVideo.srcObject = localStream;
            }
            if (audioTrack) {
                localStream.removeTrack(audioTrack);
            }
            localStream.addTrack(newAudioTrack);
            
            mediaState.requested = true;
            mediaState.audioEnabled = true;
            saveMediaState();
            await syncLocalTracksToPeers();
            updateMediaButtons();
            showToast("Microphone enabled.");
        } catch(e) {
            handleMediaError(e);
        }
        return;
    }

    audioTrack.stop();
    audioTrack.enabled = false;
    
    mediaState.requested = true;
    mediaState.audioEnabled = false;
    saveMediaState();
    updateMediaButtons();
    showToast("Microphone muted.");
});

camButton.addEventListener('click', async () => {
    let videoTrack = localStream ? localStream.getVideoTracks()[0] : null;

    if (!videoTrack || videoTrack.readyState === 'ended') {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newVideoTrack = newStream.getVideoTracks()[0];
            
            if (!localStream) {
                localStream = new MediaStream();
                localVideo.srcObject = localStream;
            }
            if (videoTrack) {
                localStream.removeTrack(videoTrack);
            }
            localStream.addTrack(newVideoTrack);
            
            mediaState.requested = true;
            mediaState.videoEnabled = true;
            saveMediaState();
            await syncLocalTracksToPeers();
            updateMediaButtons();
            showToast("Camera enabled.");
        } catch(e) {
            handleMediaError(e);
        }
        return;
    }

    videoTrack.stop();
    videoTrack.enabled = false;
    
    mediaState.requested = true;
    mediaState.videoEnabled = false;
    saveMediaState();
    updateMediaButtons();
    showToast("Camera turned off.");
});

chatInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter' && chatInput.value.trim() !== '') {
        const message = chatInput.value.trim();
        sendSignal('chat_message', message);
        chatInput.value = '';
    }
});

function appendChatMessage(username, message) {
    const el = document.createElement('div');
    el.style.marginBottom = '8px';
    const nameEl = document.createElement('strong');
    nameEl.textContent = `${username}: `;
    el.appendChild(nameEl);
    el.appendChild(document.createTextNode(message));
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function participantElementId(username) {
    if (username === USERNAME) {
        return 'participant-self';
    }

    return `participant-${username.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function addParticipant(username) {
    const participantId = participantElementId(username);
    if (!document.getElementById(participantId)) {
        const el = document.createElement('div');
        el.className = 'participant-item';
        el.id = participantId;

        const info = document.createElement('div');
        const indicator = document.createElement('span');
        indicator.className = 'status-indicator status-active';
        info.appendChild(indicator);
        info.appendChild(document.createTextNode(username));

        el.appendChild(info);
        participantList.appendChild(el);
        updateParticipantCount();
    }
}

function removeParticipant(username) {
    const el = document.getElementById(participantElementId(username));
    if (el) {
        el.remove();
        updateParticipantCount();
    }
}

function removePeerVideo(channelName) {
    const videoEl = document.getElementById(`video-${channelName}`);
    if (videoEl) {
        videoEl.remove();
    }
}

function updateParticipantCount() {
    participantCount.textContent = document.querySelectorAll('.participant-item').length;
}

let idleTimer;
const IDLE_TIMEOUT = 30000;
let isCurrentlyInactive = false;

function sendStatus(status) {
    sendSignal('user_status', status);
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        isCurrentlyInactive = true;
        sendStatus('inactive');
    } else {
        if (isCurrentlyInactive && !IS_HOST) {
            showToast("Warning: Your tab switching/inactivity was reported to the host.", true);
        }
        isCurrentlyInactive = false;
        sendStatus('active');
        resetIdleTimer();
    }
});

function resetIdleTimer() {
    if (document.visibilityState === 'hidden') {
        return;
    }

    clearTimeout(idleTimer);

    if (isCurrentlyInactive) {
        isCurrentlyInactive = false;
        sendStatus('active');
    }

    idleTimer = setTimeout(() => {
        isCurrentlyInactive = true;
        sendStatus('inactive');
    }, IDLE_TIMEOUT);
}

['mousemove', 'mousedown', 'keypress', 'touchmove'].forEach((eventName) => {
    document.addEventListener(eventName, resetIdleTimer, { passive: true });
});

resetIdleTimer();

function logAlert(message, statusType) {
    if (!IS_HOST) return;
    const logContainer = document.getElementById('activity-log-messages');
    if (!logContainer) return;

    const el = document.createElement('div');
    el.className = `activity-log-item ${statusType}`;
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    const now = new Date();
    timeSpan.textContent = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}]`;
    
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    
    el.appendChild(timeSpan);
    el.appendChild(msgSpan);
    
    logContainer.appendChild(el);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function updateParticipantStatus(username, status) {
    const el = document.getElementById(participantElementId(username));
    if (el) {
        const indicator = el.querySelector('.status-indicator');
        if (status === 'inactive') {
            indicator.className = 'status-indicator status-inactive';
            if (IS_HOST && username !== USERNAME) {
                const msg = `Student ${username} is inactive or switched tabs.`;
                showToast(msg, true);
                logAlert(msg, 'inactive');
            }
        } else {
            indicator.className = 'status-indicator status-active';
            if (IS_HOST && username !== USERNAME) {
                const msg = `Student ${username} is active.`;
                showToast(msg);
                logAlert(msg, 'active');
            }
        }
    }
}

function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast show';
    toast.style.background = isError ? 'var(--danger-color)' : 'var(--accent-color)';
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

window.addEventListener('pagehide', () => {
    stopLocalTracks();
});

window.addEventListener('beforeunload', () => {
    navigator.sendBeacon(LEAVE_ROOM_URL);
});

initializeRoom();
