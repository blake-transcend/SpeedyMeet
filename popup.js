window.addEventListener('click', function (e) {
  if (e.target.href !== undefined) {
    chrome.tabs.create({ url: e.target.href });
  }
});

var disableMicInput = document.getElementById('disable-mic');
var disableVideoInput = document.getElementById('disable-video');
var autoJoinInput = document.getElementById('auto-join');
var countdownDurationInput = document.getElementById('countdown-duration');
var countdownDurationContainer = countdownDurationInput.parentElement;
console.log('test loaded popup');

// Function to toggle countdown input visibility
function toggleCountdownVisibility() {
  if (autoJoinInput.checked) {
    countdownDurationContainer.style.display = 'flex';
  } else {
    countdownDurationContainer.style.display = 'none';
  }
}

chrome.storage.local.get(['disableMic', 'disableVideo', 'autoJoin', 'countdownDuration'], (res) => {
  disableVideoInput.checked = res.disableVideo;
  disableMicInput.checked = res.disableMic;
  autoJoinInput.checked = res.autoJoin;
  countdownDurationInput.value = res.countdownDuration || 10;

  // Set initial visibility
  toggleCountdownVisibility();

  console.log({ res });
});

disableMicInput.addEventListener('click', (e) => {
  console.log({ checked: e.target.checked });
  chrome.storage.local.set({
    disableMic: e.target.checked,
  });
});
disableVideoInput.addEventListener('click', (e) => {
  console.log({ checked: e.target.checked });
  chrome.storage.local.set({
    disableVideo: e.target.checked,
  });
});

autoJoinInput.addEventListener('click', (e) => {
  console.log({ autoJoin: e.target.checked });
  chrome.storage.local.set({
    autoJoin: e.target.checked,
  });

  // Toggle countdown input visibility
  toggleCountdownVisibility();
});

countdownDurationInput.addEventListener('change', (e) => {
  const duration = parseInt(e.target.value, 10);
  console.log({ countdownDuration: duration });
  chrome.storage.local.set({
    countdownDuration: duration,
  });
});
