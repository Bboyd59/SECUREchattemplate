let userId;
let userFirstName = '';
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let isTranscribing = false;
let micPermissionGranted = false;

document.addEventListener('DOMContentLoaded', () => {
    const registrationForm = document.getElementById('registration');
    const chatInterface = document.getElementById('chatInterface');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const voiceButton = document.getElementById('voice-input-button');
    const chatContainer = document.querySelector('.chat-container');
    const loadingIndicator = document.querySelector('.loading');
    const soundWave = document.querySelector('.sound-wave');
    const loadingAnimation = document.querySelector('.loading-animation');

    checkMicrophonePermission();
    adjustForMobile();

    document.getElementById('register-button').addEventListener('click', register);
    sendButton.addEventListener('click', sendMessage);
    voiceButton.addEventListener('click', toggleRecording);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    window.addEventListener('resize', adjustForMobile);
});

function isMobile() {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function adjustForMobile() {
    console.log("Adjusting for mobile...");
    if (isMobile()) {
        document.body.classList.add('mobile');
        const registration = document.getElementById('registration');
        const chatInterface = document.getElementById('chatInterface');
        const mobileFooter = document.querySelector('.mobile-footer');

        if (registration.style.display !== 'none') {
            chatInterface.style.display = 'none';
            registration.style.flex = '1';
            registration.style.display = 'flex';
            registration.style.flexDirection = 'column';
        } else {
            chatInterface.style.display = 'flex';
            const inputArea = document.querySelector('.input-area');
            chatInterface.style.height = `calc(100vh - ${inputArea.offsetHeight + mobileFooter.offsetHeight}px)`;

            const chatContainer = document.querySelector('.chat-container');
            chatContainer.style.height = `calc(100% - ${inputArea.offsetHeight}px)`;
        }

        document.getElementById('user-input').value = '';
    }
    console.log("Mobile adjustment complete");
}

async function checkMicrophonePermission() {
    try {
        const result = await navigator.permissions.query({ name: 'microphone' });
        if (result.state === 'granted') {
            micPermissionGranted = true;
        }
    } catch (error) {
        console.error('Error checking microphone permission:', error);
    }
}

function register() {
    const fullName = document.getElementById('fullName').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const email = document.getElementById('email').value.trim();

    if (!fullName || !phone || !email) {
        alert('Please fill in all registration fields.');
        return;
    }

    userFirstName = fullName.split(' ')[0];

    document.getElementById('registration').style.display = 'none';
    document.getElementById('chatInterface').style.display = 'flex';
    addMessage('assistant', `Welcome to Secure Choice Lending, ${userFirstName}! How can I assist you with your mortgage needs today?`);
    document.getElementById('user-input').focus();
    adjustForMobile();

    fetch('/api/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ firstName: userFirstName, phone, email }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.userId) {
            userId = data.userId;
        } else {
            console.log("Registration failed: No user ID received");
        }
    })
    .catch((error) => {
        console.error('Registration error:', error);
    });
}

function addMessage(sender, content) {
    const chatContainer = document.querySelector('.chat-container');
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `${sender}-message`);

    if (sender === 'assistant') {
        messageDiv.innerHTML = marked.parse(content);
    } else {
        messageDiv.textContent = content;
    }

    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    if (isMobile()) {
        setTimeout(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }, 0);
    }
}

function sendMessage() {
    const userInput = document.getElementById('user-input');
    const message = userInput.value.trim();
    if (!message) return;

    addMessage('user', message);
    userInput.value = '';

    document.querySelector('.loading').style.display = 'block';

    fetch('/api/chat', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, message }),
    })
    .then(response => response.json())
    .then(data => {
        document.querySelector('.loading').style.display = 'none';
        if (data.reply) {
            addMessage('assistant', data.reply);
        } else {
            addMessage('assistant', 'Sorry, I encountered an error processing your request.');
        }
    })
    .catch((error) => {
        console.error('Chat error:', error);
        document.querySelector('.loading').style.display = 'none';
        addMessage('assistant', 'Sorry, something went wrong. Please try again later.');
    });
}

async function toggleRecording() {
    const voiceButton = document.getElementById('voice-input-button');
    const soundWave = document.querySelector('.sound-wave');
    const userInput = document.getElementById('user-input');

    if (isRecording) {
        stopRecording();
        voiceButton.classList.remove('recording');
        soundWave.style.display = 'none';
        userInput.placeholder = 'Type your message...';
    } else {
        if (!micPermissionGranted) {
            const hasUsedMicBefore = localStorage.getItem('hasUsedMic') === 'true';
            if (!hasUsedMicBefore) {
                const userConfirmed = confirm("This app would like to use your microphone for voice input. Do you want to allow this?");
                if (!userConfirmed) {
                    console.log("User declined microphone access");
                    return;
                }
                localStorage.setItem('hasUsedMic', 'true');
            }
            await checkMicrophonePermission();
        }
        startRecording();
        voiceButton.classList.add('recording');
        soundWave.style.display = 'flex';
        userInput.placeholder = 'Listening...';
    }
}

function startRecording() {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            micPermissionGranted = true;
            mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
            mediaRecorder.ondataavailable = event => {
                audioChunks.push(event.data);
            };
            mediaRecorder.onstop = () => {
                sendAudioToServer();
            };
            mediaRecorder.start();
            isRecording = true;
            animateSoundWave();
        })
        .catch(error => {
            console.error('Error accessing microphone:', error);
            alert('Unable to access the microphone. Please check your browser settings and try again.');
        });
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        isRecording = false;
        isTranscribing = true;
        document.querySelector('.sound-wave').style.display = 'none';
        document.querySelector('.loading-animation').style.display = 'flex';
        document.getElementById('user-input').placeholder = 'Transcribing...';
    }
}

function animateSoundWave() {
    const bars = document.querySelectorAll('.sound-wave .bar');
    bars.forEach(bar => {
        bar.style.animationDuration = `${Math.random() * (0.7 - 0.2) + 0.2}s`;
    });
}

async function sendAudioToServer() {
    if (audioChunks.length === 0) return;

    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    audioChunks = [];

    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    try {
        document.querySelector('.loading-animation').style.display = 'flex';
        document.getElementById('user-input').placeholder = 'Transcribing...';

        const response = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (data.text) {
            const userInput = document.getElementById('user-input');
            userInput.value += (userInput.value ? ' ' : '') + data.text;
            userInput.focus();
        } else if (data.error) {
            console.error("Transcription error:", data.error);
            alert(data.error);
        } else {
            console.error("Unexpected transcription response");
            alert('An unexpected error occurred during transcription. Please try again.');
        }
    } catch (error) {
        console.error('Error sending audio to server:', error);
        alert('An error occurred while processing your voice input. Please try again.');
    } finally {
        isTranscribing = false;
        document.querySelector('.loading-animation').style.display = 'none';
        document.getElementById('user-input').placeholder = 'Type your message...';
    }
}