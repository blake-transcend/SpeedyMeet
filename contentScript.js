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
  pageContainerOverlay.style.position = 'absolute';
  pageContainerOverlay.style.top = '0';
  pageContainerOverlay.style.left = '0';
  pageContainerOverlay.style.width = '100%';
  pageContainerOverlay.style.height = '100%';
  pageContainerOverlay.style.backgroundColor = 'rgba(0,0,0,.8)';
  pageContainerOverlay.style.zIndex = '9999';
  pageContainerOverlay.style.display = 'flex';
  pageContainerOverlay.style.justifyContent = 'center';
  pageContainerOverlay.style.alignItems = 'center';
  pageContainerOverlay.id = OVERLAY_ID;

  const messageCard = document.createElement('div');
  messageCard.style.backgroundColor = 'white';
  messageCard.style.padding = '2em 4em';
  messageCard.style.borderRadius = '1em';
  messageCard.style.boxShadow = '0 4px 8px rgba(0,0,0,.2)';
  messageCard.style.fontSize = '1.5em';
  messageCard.style.display = 'flex';
  messageCard.style.flexDirection = 'column';
  messageCard.style.alignItems = 'center';
  messageCard.style.justifyContent = 'center';
  messageCard.style.width = 'max(50%, 400px)';

  const cardHeader = document.createElement('h1');
  cardHeader.textContent = 'Opening in Google Meet PWA';

  const cardDescription = document.createElement('p');
  cardDescription.textContent =
    'You have been redirected to the Google Meet PWA by the SpeedyMeet extension. ' +
    'This tab will be closed automatically once the PWA joins the meeting.';

  const useThisTabButton = document.createElement('button');
  useThisTabButton.textContent = 'Use this tab instead';
  useThisTabButton.style.backgroundColor = 'blue';
  useThisTabButton.style.color = 'white';
  useThisTabButton.style.border = 'none';
  useThisTabButton.style.padding = '10px 20px';
  useThisTabButton.style.borderRadius = '.5em';
  useThisTabButton.style.fontWeight = '600';
  useThisTabButton.style.fontSize = '16px';
  useThisTabButton.style.cursor = 'pointer';

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

(() => {
  if (isPwa()) {
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes['queryParams'] && changes['queryParams'].newValue !== '__gmInitialState') {
        const meetingCodeRegex = /([a-z0-9]{3,5}-[a-z0-9]{3,5}-[a-z0-9]{3,5})/i;
        const [currentMeetingCode] = window.location.pathname.match(meetingCodeRegex);
        const [newMeetingCode] = changes['queryParams'].newValue.match(meetingCodeRegex);
        const onCall = !!currentMeetingCode;

        // if same meeting
        if (onCall && newMeetingCode === currentMeetingCode) {
          // close original tab
          chrome.storage.local.set({
            googleMeetOpenedUrl: new Date().toISOString(),
          });
          return;
        }
        // if different meeting and on call
        if (
          onCall &&
          // if declined to switch
          !confirm('A new meeting is starting, do you want to switch to the new meeting?')
        ) {
          // reset params
          chrome.storage.local.set({
            originatingTabId: '',
            queryParams: '__gmInitialState',
            source: '',
            googleMeetDeclinedUrl: new Date().toISOString(),
          });
          return;
        }

        const newPath = changes['queryParams'].newValue;
        const newQueryParams = newPath.includes('?')
          ? newPath.includes('authuser=')
            ? newPath
            : newPath + '&authuser=0'
          : newPath + '?authuser=0';

        const currentHref = window.location.href;
        const newHref = 'https://meet.google.com/' + newQueryParams;
        if (currentHref !== newHref) {
          window.location.href = 'https://meet.google.com/' + newQueryParams;
        }

        // close original tab
        chrome.storage.local.set({
          googleMeetOpenedUrl: new Date().toISOString(),
        });
      }
    });
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
