window.addEventListener('click', function (e) {
  if (e.target.href !== undefined) {
    chrome.tabs.create({ url: e.target.href });
  }
});

var disableMicInput = document.getElementById('disable-mic');
var disableVideoInput = document.getElementById('disable-video');
console.log('test loaded popup');

chrome.storage.local.get(['disableMic', 'disableVideo'], (res) => {
  disableVideoInput.checked = res.disableVideo;
  disableMicInput.checked = res.disableMic;
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
