/*
 * contentScript.js is injected onto any meet.google.com page. This has different logic depending on if
 * it is running in the PWA or a normal tab. The PWA portion will redirect it to the correct meeting
 * (if not currently on a meeting). The normal tab will replace the content on the original page
 * informing the user they were redirected to the PWA.
 */

const OVERLAY_ID = 'meet-switch-overlay';
const MEETING_CODE_REGEX = /([a-z0-9]{3,5}-[a-z0-9]{3,5}-[a-z0-9]{3,5})/i;

// Timing constants
const DEFAULT_INTERVAL_MS = 300;
const DEFAULT_TIMEOUT_MS = 15000;
const INITIALIZATION_DELAY_MS = 1000;
const DEFAULT_COUNTDOWN_DURATION = 10;
const TTS_ANNOUNCEMENT_INTERVAL = 5;

// Aria labels and selectors
const ARIA_LABELS = {
  CALL_CONTROLS: 'Call controls',
  TURN_OFF_MIC: 'Turn off microphone',
  TURN_OFF_CAMERA: 'Turn off camera',
};

// Join button text variations
const JOIN_BUTTON_TEXTS = ['join anyway', 'join', 'ask to join', 'join now'];

// Storage keys
const STORAGE_KEYS = {
  GOOGLE_MEET_OPENED_URL: 'googleMeetOpenedUrl',
  GOOGLE_MEET_DECLINED_URL: 'googleMeetDeclinedUrl',
  ORIGINATING_TAB_ID: 'originatingTabId',
  QUERY_PARAMS: 'queryParams',
  SHOULD_AUTO_JOIN_OVERRIDE: 'shouldAutoJoinOverride',
};

// Global state for countdown management
let activeCountdown = null;

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

/**
 * Helper function to determine if currently on a call and extract meeting code
 * @returns {{onCall: boolean, meetingCode: string|null}} Object with call status and meeting code
 */
function getCurrentCallStatus() {
  const pathMatch = window.location.pathname.match(MEETING_CODE_REGEX);
  const meetingCode = pathMatch ? pathMatch[1] : null;
  const notOnLanding = window.location.pathname !== '/landing';
  const hasCallControls = !!document.querySelector(`[aria-label="${ARIA_LABELS.CALL_CONTROLS}"]`);

  // Check if we're on a call by verifying:
  // 1. We're not on the landing page
  // 2. We have call controls present
  // 3. We have a meeting code
  const onCall = !!meetingCode && hasCallControls && notOnLanding;

  return {
    onCall,
    meetingCode,
  };
}

/**
 * Helper function for text-to-speech announcements
 * @param {string} text - The text to speak
 */
function speakText(text) {
  if (chrome.runtime) {
    chrome.runtime.sendMessage(
      {
        type: 'SPEAK_TEXT',
        text: text,
        rate: 1.0,
        pitch: 1.0,
        volume: 1.0,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('Failed to send TTS message:', chrome.runtime.lastError);
        } else {
          console.log('TTS message sent successfully for:', text);
        }
      },
    );
  } else {
    console.warn('chrome.runtime is not available');
  }
}

/**
 * Finds and returns a join meeting button if available
 * @returns {HTMLElement|null} The join button element or null if not found
 */
function findJoinButton() {
  return [...document.querySelectorAll('button:not([disabled])')].find((btn) =>
    JOIN_BUTTON_TEXTS.includes(btn.innerText?.trim().toLowerCase()),
  );
}

/**
 * Checks if a countdown is currently active
 * @returns {boolean} True if a countdown is active
 */
function isCountdownActive() {
  return activeCountdown !== null;
}

/**
 * Cancels the currently active countdown if one exists
 */
function cancelActiveCountdown() {
  if (activeCountdown) {
    console.log('Cancelling active countdown');
    activeCountdown.cleanup();
    activeCountdown = null;
    return true;
  }
  return false;
}

/**
 * Starts a countdown with TTS announcements before auto-joining
 * @param {number} duration - The countdown duration in seconds
 * @param {number} ttsInterval - Interval in seconds for TTS announcements
 */
function startAutoJoinCountdown(
  duration = DEFAULT_COUNTDOWN_DURATION,
  ttsInterval = TTS_ANNOUNCEMENT_INTERVAL,
) {
  // Cancel any existing countdown first
  cancelActiveCountdown();

  const joinMeetingButton = findJoinButton();
  if (!joinMeetingButton) {
    console.log('Auto-join countdown cancelled: No join button found');
    return;
  }

  let countdown = duration;
  let countdownInterval;

  // Create countdown display element
  const countdownDisplay = document.createElement('div');
  countdownDisplay.className = 'auto-join-countdown-display';

  // Create cancel button
  const cancelButton = document.createElement('button');
  cancelButton.innerText = 'Cancel Auto-Join';
  cancelButton.className = 'auto-join-cancel-btn btn';

  // Function to check if elements are still on screen and visible
  function areElementsVisible() {
    const countdownInDom = document.contains(countdownDisplay);
    const cancelInDom = document.contains(cancelButton);
    const countdownVisible = countdownInDom && countdownDisplay.offsetParent !== null;
    const cancelVisible = cancelInDom && cancelButton.offsetParent !== null;

    return {
      countdownInDom,
      cancelInDom,
      countdownVisible,
      cancelVisible,
      bothVisible: countdownVisible && cancelVisible,
    };
  }

  // Function to re-add elements to the page
  function reAddElements() {
    const currentJoinButton = findJoinButton();
    if (!currentJoinButton || !currentJoinButton.parentNode) {
      console.log('Cannot re-add elements: Join button not found');
      return false;
    }

    // Remove elements if they exist but are detached
    if (countdownDisplay.parentNode) countdownDisplay.remove();
    if (cancelButton.parentNode) cancelButton.remove();

    // Re-add elements
    currentJoinButton.parentNode.insertBefore(countdownDisplay, currentJoinButton.nextSibling);
    currentJoinButton.parentNode.insertBefore(cancelButton, countdownDisplay.nextSibling);

    console.log('Re-added countdown elements to page');
    return true;
  }

  // Function to cleanup and restore original state
  function cleanup() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (countdownDisplay && countdownDisplay.parentNode) {
      countdownDisplay.remove();
    }
    if (cancelButton && cancelButton.parentNode) {
      cancelButton.remove();
    }
    // Clear global state
    if (activeCountdown && activeCountdown.cleanup === cleanup) {
      activeCountdown = null;
    }
    console.log('Auto-join countdown cleanup completed');
  }

  // Cancel button click handler
  cancelButton.onclick = () => {
    console.log('Auto-join cancelled by user');
    speakText('Auto-join cancelled');
    cleanup();
  };

  // Insert countdown display and cancel button after join button
  if (joinMeetingButton.parentNode) {
    joinMeetingButton.parentNode.insertBefore(countdownDisplay, joinMeetingButton.nextSibling);
    joinMeetingButton.parentNode.insertBefore(cancelButton, countdownDisplay.nextSibling);
  }

  // Update countdown display
  function updateCountdownDisplay() {
    countdownDisplay.textContent = `Auto-joining in ${countdown}s`;
  }

  console.log(`Starting auto-join countdown: ${duration} seconds`);
  speakText(`Auto-joining meeting in ${countdown} seconds`);
  updateCountdownDisplay();

  countdownInterval = setInterval(() => {
    countdown--;
    console.log(`Auto-join countdown: ${countdown} seconds remaining`);

    if (countdown > 0) {
      // Check if elements are still visible
      const visibility = areElementsVisible();

      if (!visibility.bothVisible) {
        console.log('Countdown elements not visible:', visibility);

        // Try to re-add elements
        if (!reAddElements()) {
          console.log('Failed to re-add elements, stopping countdown');
          cleanup();
          return;
        }
      }

      updateCountdownDisplay();

      // Announce every N seconds
      if (ttsInterval > 0 && countdown % ttsInterval === 0) {
        speakText(`Auto-joining in ${countdown} seconds`);
      }
    } else {
      console.log('Auto-join countdown completed - joining meeting now');
      speakText('Joining meeting now');
      cleanup();

      // Click the join button
      const finalJoinButton = findJoinButton();
      if (finalJoinButton) {
        finalJoinButton.click();
      }
    }
  }, 1000);

  // Store the countdown in global state
  activeCountdown = {
    cleanup,
    duration,
    startTime: Date.now(),
  };
}

function disableVideoAndMicConfig(joiningNewMeeting) {
  chrome.storage.local.get(
    [
      'disableMic',
      'disableVideo',
      'shouldAutoJoinOverride',
      'autoJoin',
      'countdownDuration',
      'ttsAnnouncementInterval',
    ],
    (res) => {
      // Helper to run interval with timeout
      function runInterval(fn, intervalMs = DEFAULT_INTERVAL_MS, timeoutMs = DEFAULT_TIMEOUT_MS) {
        const start = Date.now();
        const interval = setInterval(() => {
          const done = fn();
          if (done || Date.now() - start > timeoutMs) {
            clearInterval(interval);
          }
        }, intervalMs);
      }

      // Mic button interval
      if (res.disableMic) {
        runInterval(() => {
          const disableMicBtn = document.querySelector(
            `[aria-label="${ARIA_LABELS.TURN_OFF_MIC}"]`,
          );
          if (disableMicBtn) {
            disableMicBtn.click();
            return true;
          }
          return false;
        });
      }

      // Video button interval
      if (res.disableVideo) {
        runInterval(() => {
          const disableVideoBtn = document.querySelector(
            `[aria-label="${ARIA_LABELS.TURN_OFF_CAMERA}"]`,
          );
          if (disableVideoBtn) {
            disableVideoBtn.click();
            return true;
          }
          return false;
        });
      }

      if (joiningNewMeeting) {
        // Join meeting button interval
        if (res.shouldAutoJoinOverride) {
          runInterval(() => {
            const joinMeetingButton = findJoinButton();
            const { onCall } = getCurrentCallStatus();
            if (joinMeetingButton && !onCall) {
              chrome.storage.local.set({
                [STORAGE_KEYS.SHOULD_AUTO_JOIN_OVERRIDE]: false,
              });
              joinMeetingButton.click();
              return true;
            }
            return false;
          });
        } else if (res.autoJoin) {
          const countdownDuration = res.countdownDuration || DEFAULT_COUNTDOWN_DURATION;
          const ttsInterval = res.ttsAnnouncementInterval || TTS_ANNOUNCEMENT_INTERVAL;
          runInterval(() => {
            const joinMeetingButton = findJoinButton();
            const { onCall } = getCurrentCallStatus();
            if (joinMeetingButton && !onCall) {
              startAutoJoinCountdown(countdownDuration, ttsInterval);
              return true;
            }
            return false;
          });
        }
      }
    },
  );
}

function switchToNewCall(changes, fromAlert) {
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
    closeOriginalTab();

    if (fromAlert) {
      // if switching to new meeting manually should auto join
      chrome.storage.local.set({
        [STORAGE_KEYS.SHOULD_AUTO_JOIN_OVERRIDE]: true,
      });
    }

    window.location.href = 'https://meet.google.com/' + newQueryParams;
  }

  // close original tab
  closeOriginalTab();

  // disable mic & video if configured
  disableVideoAndMicConfig(true);
}

function closeOriginalTab() {
  // close original tab
  chrome.storage.local.set({
    [STORAGE_KEYS.GOOGLE_MEET_OPENED_URL]: new Date().toISOString(),
  });
}

function ignoreNewMeeting() {
  chrome.storage.local.set({
    [STORAGE_KEYS.ORIGINATING_TAB_ID]: '',
    [STORAGE_KEYS.QUERY_PARAMS]: '__gmInitialState',
    source: '',
    [STORAGE_KEYS.GOOGLE_MEET_DECLINED_URL]: new Date().toISOString(),
  });
}

(() => {
  if (isPwa()) {
    chrome.storage.onChanged.addListener(function (changes) {
      if (
        changes[STORAGE_KEYS.QUERY_PARAMS] &&
        changes[STORAGE_KEYS.QUERY_PARAMS].newValue !== '__gmInitialState'
      ) {
        const { onCall, meetingCode: currentMeetingCode } = getCurrentCallStatus();
        const [newMeetingCode] =
          changes[STORAGE_KEYS.QUERY_PARAMS].newValue.match(MEETING_CODE_REGEX) || [];

        // if same meeting
        if (onCall && newMeetingCode === currentMeetingCode) {
          closeOriginalTab();
          return;
        }
        // if different meeting and on call
        if (onCall) {
          document.body.prepend(
            buildNextMeetingAlert((shouldSwitch) => {
              if (shouldSwitch) {
                switchToNewCall(changes, true);
              } else {
                ignoreNewMeeting();
              }
            }),
          );
          // close original tab once the ui is shown
          closeOriginalTab();
        } else {
          switchToNewCall(changes);
        }
      }
    });

    setTimeout(() => {
      const { onCall } = getCurrentCallStatus();
      disableVideoAndMicConfig(!onCall);
    }, INITIALIZATION_DELAY_MS);
  } else {
    // Normal tab, add listener to replace UI with
    chrome.storage.onChanged.addListener(function (changes) {
      if (
        changes[STORAGE_KEYS.ORIGINATING_TAB_ID] &&
        changes[STORAGE_KEYS.ORIGINATING_TAB_ID].newValue
      ) {
        document.body.appendChild(buildNotificationElements());
      }
      if (changes[STORAGE_KEYS.GOOGLE_MEET_DECLINED_URL] && document.getElementById(OVERLAY_ID)) {
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
