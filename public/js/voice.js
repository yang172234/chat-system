// ==================== Voice Module ====================

const btnVoiceToggle = document.getElementById('btn-voice-toggle');
const textInputContainer = document.getElementById('text-input-container');
const voiceInputContainer = document.getElementById('voice-input-container');
const btnRecord = document.getElementById('btn-record');
const recordingTime = document.getElementById('recording-time');

let mediaRecorder = null;
let audioChunks = [];
let recordStartTime = null;
let recordTimer = null;
let isVoiceMode = false;

// ==================== Toggle Voice/Text Mode ====================
btnVoiceToggle.addEventListener('click', () => {
  isVoiceMode = !isVoiceMode;
  if (isVoiceMode) {
    textInputContainer.style.display = 'none';
    voiceInputContainer.style.display = 'flex';
    btnVoiceToggle.textContent = '⌨️';
    btnVoiceToggle.title = '文字消息';
    btnSend.style.display = 'none';
  } else {
    textInputContainer.style.display = 'block';
    voiceInputContainer.style.display = 'none';
    btnVoiceToggle.textContent = '🎤';
    btnVoiceToggle.title = '语音消息';
    btnSend.style.display = 'block';
    stopRecording(false);
  }
});

// ==================== Recording ====================
btnRecord.addEventListener('mousedown', startRecording);
btnRecord.addEventListener('mouseup', () => stopRecording(true));
btnRecord.addEventListener('mouseleave', () => stopRecording(true));

// Touch events for mobile
btnRecord.addEventListener('touchstart', (e) => {
  e.preventDefault();
  startRecording();
});
btnRecord.addEventListener('touchend', (e) => {
  e.preventDefault();
  stopRecording(true);
});

async function startRecording() {
  if (!currentConversation) {
    alert('请先选择一个联系人或群聊');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.start();
    recordStartTime = Date.now();

    // Update UI
    btnRecord.textContent = '🔴 正在录音...';
    btnRecord.style.background = '#C0392B';

    // Update timer
    recordTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
      const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const sec = String(elapsed % 60).padStart(2, '0');
      recordingTime.textContent = `${min}:${sec}`;
    }, 200);

  } catch (err) {
    console.error('Microphone access denied:', err);
    alert('无法访问麦克风，请检查权限设置。');
  }
}

async function stopRecording(send) {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  return new Promise((resolve) => {
    mediaRecorder.onstop = async () => {
      // Stop all tracks
      mediaRecorder.stream.getTracks().forEach(t => t.stop());

      // Reset UI
      btnRecord.textContent = '🔴 按住录音';
      btnRecord.style.background = '';
      recordingTime.textContent = '00:00';
      clearInterval(recordTimer);

      if (send && audioChunks.length > 0 && currentConversation) {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const duration = (Date.now() - recordStartTime) / 1000;

        // Convert blob to base64
        const reader = new FileReader();
        reader.onload = () => {
          const base64Data = reader.result.split(',')[1];

          if (currentConversation.type === 'private') {
            App.socket.emit('voice-message', {
              toUserId: currentConversation.id,
              audioData: base64Data,
              duration,
            }, (response) => {
              if (response?.success) {
                console.log('Voice message sent, id:', response.messageId);
              }
            });
          } else if (currentConversation.type === 'group') {
            App.socket.emit('group-voice-message', {
              groupId: currentConversation.id,
              audioData: base64Data,
              duration,
            }, (response) => {
              if (response?.success) {
                console.log('Group voice message sent, id:', response.messageId);
              }
            });
          }
        };
        reader.readAsDataURL(audioBlob);
      }

      mediaRecorder = null;
      audioChunks = [];
      resolve();
    };

    mediaRecorder.stop();
  });
}

// ==================== Play Voice Message ====================
// playVoice function is defined in chat.js but let's augment it
// to handle playback better

const originalPlayVoice = window.playVoice;
window.playVoice = function(filePath) {
  if (!filePath) return;

  // Find the audio element if it exists in the DOM, or create one
  const audio = new Audio(filePath);
  audio.play().catch(err => {
    console.error('Voice playback failed:', err);
  });
};
