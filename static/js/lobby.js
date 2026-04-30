console.log("Meeting Lobby Initialized");

let previewStream = null;

const mediaStateKey = `signalroom-prejoin:${ROOM_ID}`;

const previewVideo = document.getElementById('preview-video');
const previewPlaceholder = document.getElementById('preview-placeholder');
const requestMediaButton = document.getElementById('btn-request-media');
const micButton = document.getElementById('btn-toggle-mic');
const camButton = document.getElementById('btn-toggle-cam');
const joinRoomButton = document.getElementById('btn-join-room');
const shareInviteButton = document.getElementById('btn-share-invite');
const mediaStatusNote = document.getElementById('media-status-note');
const micPermissionStatus = document.getElementById('mic-permission-status');
const cameraPermissionStatus = document.getElementById('camera-permission-status');
const roomCodeInput = document.getElementById('room-code');
const inviteLinkInput = document.getElementById('invite-link');
const copyButtons = document.querySelectorAll('[data-copy-target]');
const toastContainer = document.getElementById('toast-container');

const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const supportsMediaDevices = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
const hasSecureMediaContext = window.isSecureContext || isLocalhost;

const mediaState = loadMediaState();

refreshPermissionState();
updateMediaButtons();
updateMediaNote();

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

async function requestPreviewMedia() {
    if (!supportsMediaDevices) {
        setPermissionBadge(micPermissionStatus, 'unavailable');
        setPermissionBadge(cameraPermissionStatus, 'unavailable');
        mediaStatusNote.textContent = "This browser does not support camera and microphone access.";
        showToast("Browser media access is not supported.", true);
        return;
    }

    if (!hasSecureMediaContext) {
        setPermissionBadge(micPermissionStatus, 'unavailable');
        setPermissionBadge(cameraPermissionStatus, 'unavailable');
        mediaStatusNote.textContent = "Camera and microphone require HTTPS or localhost. A hosted Python server cannot bypass this browser rule.";
        showToast("Open the site on HTTPS to use camera and microphone.", true);
        return;
    }

    requestMediaButton.disabled = true;
    requestMediaButton.textContent = "Waiting for permission...";
    setPermissionBadge(micPermissionStatus, 'pending');
    setPermissionBadge(cameraPermissionStatus, 'pending');
    mediaStatusNote.textContent = "Accept the browser permission prompt to preview camera and microphone.";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

        stopPreviewTracks();
        previewStream = stream;
        previewVideo.srcObject = previewStream;

        mediaState.requested = true;
        mediaState.audioEnabled = true;
        mediaState.videoEnabled = true;
        saveMediaState();
        updatePreviewState();
        updateMediaButtons();
        setPermissionBadge(micPermissionStatus, 'granted');
        setPermissionBadge(cameraPermissionStatus, 'granted');
        mediaStatusNote.textContent = "Camera and microphone are ready. Your chosen on/off state will be used when you join the meeting.";
        showToast("Camera and microphone enabled.");
    } catch (error) {
        console.error("Error accessing media devices.", error);
        handleMediaError(error);
    } finally {
        requestMediaButton.disabled = false;
        requestMediaButton.textContent = previewStream ? "Reconnect devices" : "Enable camera and microphone";
        refreshPermissionState();
    }
}

function stopPreviewTracks() {
    if (previewStream) {
        previewStream.getTracks().forEach((track) => track.stop());
    }
}

// applySavedTrackState removed

function updatePreviewState() {
    if (!previewStream) {
        previewPlaceholder.hidden = false;
        return;
    }

    const videoTrack = previewStream.getVideoTracks()[0];
    const hasActiveVideo = videoTrack && videoTrack.readyState !== 'ended';

    if (hasActiveVideo) {
        previewPlaceholder.hidden = true;
    } else {
        previewPlaceholder.hidden = false;
        previewPlaceholder.innerHTML = "<strong>Camera preview is off</strong><span>Turn the camera on when you are ready to appear in the meeting.</span>";
    }
}

function setPermissionBadge(element, state) {
    const labels = {
        granted: 'Allowed',
        denied: 'Blocked',
        prompt: 'Ask user',
        pending: 'Waiting',
        unavailable: 'Unavailable'
    };
    const normalizedState = labels[state] ? state : 'prompt';

    element.className = `status-badge status-${normalizedState}`;
    element.textContent = labels[normalizedState];
}

async function refreshPermissionState() {
    if (previewStream) {
        setPermissionBadge(micPermissionStatus, 'granted');
        setPermissionBadge(cameraPermissionStatus, 'granted');
        return;
    }

    if (!supportsMediaDevices) {
        setPermissionBadge(micPermissionStatus, 'unavailable');
        setPermissionBadge(cameraPermissionStatus, 'unavailable');
        return;
    }

    if (!navigator.permissions || !navigator.permissions.query) {
        setPermissionBadge(micPermissionStatus, 'prompt');
        setPermissionBadge(cameraPermissionStatus, 'prompt');
        return;
    }

    await Promise.all([
        watchPermission('microphone', micPermissionStatus),
        watchPermission('camera', cameraPermissionStatus)
    ]);
}

async function watchPermission(permissionName, targetElement) {
    try {
        const permissionStatus = await navigator.permissions.query({ name: permissionName });
        setPermissionBadge(targetElement, permissionStatus.state);
        permissionStatus.onchange = () => setPermissionBadge(targetElement, permissionStatus.state);
    } catch (error) {
        setPermissionBadge(targetElement, 'prompt');
    }
}

function updateMediaButtons() {
    const audioTrack = previewStream ? previewStream.getAudioTracks()[0] : null;
    const videoTrack = previewStream ? previewStream.getVideoTracks()[0] : null;

    const hasActiveAudio = audioTrack && audioTrack.readyState !== 'ended';
    const hasActiveVideo = videoTrack && videoTrack.readyState !== 'ended';

    micButton.disabled = false;
    camButton.disabled = false;

    micButton.classList.toggle('active', !hasActiveAudio);
    camButton.classList.toggle('active', !hasActiveVideo);

    micButton.textContent = hasActiveAudio ? 'Mic on' : 'Mic off';
    camButton.textContent = hasActiveVideo ? 'Cam on' : 'Cam off';
}

function updateMediaNote() {
    if (!supportsMediaDevices) {
        mediaStatusNote.textContent = "This browser does not support camera and microphone access.";
        return;
    }

    if (!hasSecureMediaContext) {
        mediaStatusNote.textContent = "Use HTTPS in production. Browsers block camera and microphone on insecure pages.";
        return;
    }

    if (!previewStream) {
        mediaStatusNote.textContent = "You can join without media, or enable it here and enter the room with your saved camera and microphone state.";
    }
}

function handleMediaError(error) {
    const permissionDenied = ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
    const deviceMissing = ['NotFoundError', 'DevicesNotFoundError'].includes(error.name);
    const deviceBusy = ['NotReadableError', 'TrackStartError'].includes(error.name);

    if (permissionDenied) {
        setPermissionBadge(micPermissionStatus, 'denied');
        setPermissionBadge(cameraPermissionStatus, 'denied');
        mediaStatusNote.textContent = "The user blocked camera or microphone access in the browser. Allow the permission and try again.";
        showToast("Camera or microphone permission was blocked.", true);
        return;
    }

    if (deviceMissing) {
        setPermissionBadge(micPermissionStatus, 'unavailable');
        setPermissionBadge(cameraPermissionStatus, 'unavailable');
        mediaStatusNote.textContent = "No camera or microphone device was found on this computer or phone.";
        showToast("No camera or microphone device was found.", true);
        return;
    }

    if (deviceBusy) {
        setPermissionBadge(micPermissionStatus, 'unavailable');
        setPermissionBadge(cameraPermissionStatus, 'unavailable');
        mediaStatusNote.textContent = "Another application is already using the camera or microphone.";
        showToast("Camera or microphone is busy in another app.", true);
        return;
    }

    setPermissionBadge(micPermissionStatus, 'unavailable');
    setPermissionBadge(cameraPermissionStatus, 'unavailable');
    mediaStatusNote.textContent = "The browser could not start camera or microphone access.";
    showToast("Cannot access camera or microphone.", true);
}

async function copyText(text, successMessage) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            fallbackCopyText(text);
        }

        showToast(successMessage);
    } catch (error) {
        console.error("Error copying text:", error);
        showToast("Could not copy text.", true);
    }
}

function fallbackCopyText(text) {
    const helperInput = document.createElement('textarea');
    helperInput.value = text;
    helperInput.setAttribute('readonly', '');
    helperInput.style.position = 'absolute';
    helperInput.style.left = '-9999px';
    document.body.appendChild(helperInput);
    helperInput.select();
    document.execCommand('copy');
    helperInput.remove();
}

requestMediaButton.addEventListener('click', requestPreviewMedia);

micButton.addEventListener('click', async () => {
    let audioTrack = previewStream ? previewStream.getAudioTracks()[0] : null;

    if (!audioTrack || audioTrack.readyState === 'ended') {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const newAudioTrack = newStream.getAudioTracks()[0];
            if (!previewStream) {
                previewStream = new MediaStream();
                previewVideo.srcObject = previewStream;
            }
            if (audioTrack) previewStream.removeTrack(audioTrack);
            previewStream.addTrack(newAudioTrack);
            
            mediaState.requested = true;
            mediaState.audioEnabled = true;
            saveMediaState();
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
    let videoTrack = previewStream ? previewStream.getVideoTracks()[0] : null;

    if (!videoTrack || videoTrack.readyState === 'ended') {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const newVideoTrack = newStream.getVideoTracks()[0];
            if (!previewStream) {
                previewStream = new MediaStream();
                previewVideo.srcObject = previewStream;
            }
            if (videoTrack) previewStream.removeTrack(videoTrack);
            previewStream.addTrack(newVideoTrack);
            
            mediaState.requested = true;
            mediaState.videoEnabled = true;
            saveMediaState();
            updateMediaButtons();
            updatePreviewState();
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
    updatePreviewState();
    showToast("Camera turned off.");
});

joinRoomButton.addEventListener('click', () => {
    if (!previewStream) {
        mediaState.requested = false;
        mediaState.audioEnabled = true;
        mediaState.videoEnabled = true;
        saveMediaState();
        window.location.href = JOIN_ROOM_URL;
        return;
    }

    const audioTrack = previewStream.getAudioTracks()[0];
    const videoTrack = previewStream.getVideoTracks()[0];
    
    const audioEnabled = audioTrack && audioTrack.readyState !== 'ended';
    const videoEnabled = videoTrack && videoTrack.readyState !== 'ended';

    if (!audioEnabled && !videoEnabled) {
        mediaState.requested = false;
    } else {
        mediaState.requested = true;
    }
    
    mediaState.audioEnabled = audioEnabled;
    mediaState.videoEnabled = videoEnabled;
    saveMediaState();
    window.location.href = JOIN_ROOM_URL;
});

copyButtons.forEach((button) => {
    button.addEventListener('click', async () => {
        const target = button.dataset.copyTarget;
        const text = target === 'room-code' ? roomCodeInput.value : inviteLinkInput.value;
        const successMessage = target === 'room-code' ? "Classroom code copied." : "Invite link copied.";
        await copyText(text, successMessage);
    });
});

shareInviteButton.addEventListener('click', async () => {
    const shareUrl = inviteLinkInput.value;
    const shareText = `Join ${USERNAME}'s classroom with code ${ROOM_ID}.`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Classroom invite',
                text: shareText,
                url: shareUrl
            });
            return;
        } catch (error) {
            if (error.name === 'AbortError') {
                return;
            }
        }
    }

    await copyText(`${shareText} ${shareUrl}`, "Invite details copied.");
});

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
    stopPreviewTracks();
});
