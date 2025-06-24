/*
 * contentScript.js is injected onto any meet.google.com page. This has different logic depending on if
 * it is running in the PWA or a normal tab. The PWA portion will redirect it to the correct meeting
 * (if not currently on a meeting). The normal tab will replace the content on the original page
 * informing the user they were redirected to the PWA.
 */

const OVERLAY_ID = 'meet-switch-overlay';

/**
 * Builds the notification elements to inform the user they were redirected to the PWA.
 * @returns {HTMLDivElement} the overlay element containing the notification
 */
function buildNotificationElements() {
  const pageContainerOverlay = document.createElement('div');
  pageContainerOverlay.className = 'meet-switch-overlay';
  pageContainerOverlay.id = OVERLAY_ID;

  const messageCard = document.createElement('div');
  messageCard.className = 'meet-switch-message-card';

  const cardHeader = document.createElement('h1');
  cardHeader.textContent = 'Opening in Google Meet PWA';

  const cardDescription = document.createElement('p');
  cardDescription.textContent =
    'You have been redirected to the Google Meet PWA by the SpeedyMeet extension. ' +
    'This tab will be closed automatically once the PWA joins the meeting.';

  const useThisTabButton = document.createElement('button');
  useThisTabButton.textContent = 'Use this tab instead';
  useThisTabButton.className = 'meet-switch-use-tab-btn btn';

  const dismissOverlay = () => {
    pageContainerOverlay.remove();
  };
  useThisTabButton.onclick = dismissOverlay;
  pageContainerOverlay.onclick = dismissOverlay;
  messageCard.onclick = (e) => {
    e.stopPropagation();
  };

  pageContainerOverlay.appendChild(messageCard);
  messageCard.appendChild(cardHeader);
  messageCard.appendChild(cardDescription);
  messageCard.appendChild(useThisTabButton);

  return pageContainerOverlay;
}

function buildNextMeetingAlert(onClick) {
  const container = document.createElement('div');
  container.className = 'meet-next-meeting-alert';

  const message = document.createElement('div');
  message.textContent = 'You have a new meeting starting!';
  message.className = 'meet-next-meeting-message';

  const switchBtn = document.createElement('button');
  switchBtn.textContent = 'Switch to meeting';
  switchBtn.className = 'meet-next-meeting-switch-btn btn';
  switchBtn.onclick = () => {
    onClick(true);
    container.remove();
  };

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.className = 'meet-next-meeting-dismiss-btn btn';
  dismissBtn.onclick = () => {
    onClick(false);
    container.remove();
  };

  const btnContainer = document.createElement('div');
  btnContainer.className = 'meet-next-meeting-btn-container';

  btnContainer.appendChild(switchBtn);
  btnContainer.appendChild(dismissBtn);
  container.appendChild(message);
  container.appendChild(btnContainer);

  return container;
}

function disableVideoAndMicConfig() {
  chrome.storage.local.get(['disableMic', 'disableVideo'], (res) => {
    var disableMicBtn = document.querySelector('[aria-label="Turn off microphone"]');
    var disableVideoBtn = document.querySelector('[aria-label="Turn off camera"]');
    if (disableMicBtn && res.disableMic) {
      disableMicBtn.click();
    }
    if (disableVideoBtn && res.disableVideo) {
      disableVideoBtn.click();
    }
  });
}

function switchToNewCall(changes) {
  const newPath = changes['queryParams'].newValue;
  const newQueryParams = newPath.includes('?')
    ? newPath.includes('authuser=')
      ? newPath
      : newPath + '&authuser=0'
    : newPath + '?authuser=0';

  const currentHref = window.location.href;
  const newHref = 'https://meet.google.com/' + newQueryParams;
  if (currentHref !== newHref) {
    // opening meeting so we can close original tab
    chrome.storage.local.set({
      googleMeetOpenedUrl: new Date().toISOString(),
    });

    window.location.href = 'https://meet.google.com/' + newQueryParams;
  }

  // close original tab
  chrome.storage.local.set({
    googleMeetOpenedUrl: new Date().toISOString(),
  });

  // disable mic & video if configured
  disableVideoAndMicConfig();
}

(() => {
  if (isPwa()) {
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes['queryParams'] && changes['queryParams'].newValue !== '__gmInitialState') {
        const meetingCodeRegex = /([a-z0-9]{3,5}-[a-z0-9]{3,5}-[a-z0-9]{3,5})/i;
        const [currentMeetingCode] = window.location.pathname.match(meetingCodeRegex) || [];
        const [newMeetingCode] = changes['queryParams'].newValue.match(meetingCodeRegex) || [];
        const onCall =
          !!currentMeetingCode && document.querySelector('[aria-label="Call controls"]');

        // if same meeting
        if (onCall && newMeetingCode === currentMeetingCode) {
          // close original tab
          chrome.storage.local.set({
            googleMeetOpenedUrl: new Date().toISOString(),
          });
          return;
        }
        // if different meeting and on call
        if (onCall) {
          document.body.prepend(
            buildNextMeetingAlert((shouldSwitch) => {
              if (shouldSwitch) {
                switchToNewCall(changes);
              } else {
                chrome.storage.local.set({
                  originatingTabId: '',
                  queryParams: '__gmInitialState',
                  source: '',
                  googleMeetDeclinedUrl: new Date().toISOString(),
                });
              }
            }),
          );
        } else {
          switchToNewCall(changes);
        }
      }
    });

    setTimeout(() => {
      disableVideoAndMicConfig();
    }, 1000);
  } else {
    // Normal tab, add listener to replace UI with
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes['originatingTabId'] && changes['originatingTabId'].newValue) {
        document.body.appendChild(buildNotificationElements());
      }
      if (changes['googleMeetDeclinedUrl'] && document.getElementById(OVERLAY_ID)) {
        document.getElementById(OVERLAY_ID).remove();
      }
    });
  }
})();

function isPwa() {
  return ['fullscreen', 'standalone', 'minimal-ui'].some(
    (displayMode) => window.matchMedia('(display-mode: ' + displayMode + ')').matches,
  );
}
